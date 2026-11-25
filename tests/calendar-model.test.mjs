import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const model = createRequire(import.meta.url)('../calendar-model.js');

const BEFORE = new Date('2026-12-13T23:59:59.000Z');
const SWITCH = new Date(model.TROY_ZONE_SWITCH);
const AFTER = new Date('2026-12-14T15:00:00.000Z');

function at(local, zone) {
  const [date, time] = local.split(' ');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return model.zonedInstant(year, month, day, hour, minute, 0, zone).toISOString();
}

test('Troy stays in Belem through Dec 13 and switches at Belem midnight', () => {
  assert.equal(model.troyZone(BEFORE), 'America/Belem');
  assert.equal(model.troyZone(new Date(SWITCH.getTime() - 1)), 'America/Belem');
  assert.equal(model.troyZone(SWITCH), 'America/Denver');
  assert.equal(model.troyZone(AFTER), 'America/Denver');
  assert.equal(model.zonedInstant(2026, 12, 14, 0, 0, 0, 'America/Belem').toISOString(), model.TROY_ZONE_SWITCH);
});

test('half-open ranges do not treat a shared endpoint as an overlap', () => {
  const first = { id: 'a', status: 'confirmed', starts_at: '2026-12-01T12:00:00Z', ends_at: '2026-12-01T13:00:00Z' };
  const next = { id: 'b', status: 'tentative', starts_at: '2026-12-01T13:00:00Z', ends_at: '2026-12-01T14:00:00Z' };
  const over = { id: 'c', status: 'confirmed', starts_at: '2026-12-01T12:30:00Z', ends_at: '2026-12-01T12:31:00Z' };
  const cancelled = { id: 'd', status: 'cancelled', starts_at: '2026-12-01T12:00:00Z', ends_at: '2026-12-01T15:00:00Z' };
  assert.equal(model.rangesOverlap(first, next), false);
  assert.equal(model.rangesOverlap(first, over), true);
  const ids = model.overlappingIds([first, next, over, cancelled]);
  assert.deepEqual([...ids].sort(), ['a', 'c']);
});

test('clocks ignore the event zone and the viewer zone and use Mountain Time', () => {
  const event = {
    title: 'Demo block',
    starts_at: at('2026-12-01 09:00', 'America/Belem'),
    ends_at: at('2026-12-01 10:00', 'America/Belem'),
    tz: 'America/Belem',
    all_day: false,
    status: 'confirmed'
  };
  const described = model.describeEvent(event, BEFORE);
  assert.match(described.primary, /5:00 AM to 6:00 AM/);
  assert.equal(described.timeLabel, 'MT');
  assert.equal(described.secondary, '');
  assert.equal(described.zone, 'America/Denver');
  assert.doesNotMatch(`${described.primary} ${described.timeLabel}`, /Belem|MST|MDT/);

  const summer = model.describeEvent({
    ...event,
    starts_at: at('2026-07-01 09:00', 'America/Belem'),
    ends_at: at('2026-07-01 10:00', 'America/Belem')
  }, new Date('2026-07-01T12:00:00Z'));
  assert.match(summer.primary, /6:00 AM to 7:00 AM/);
  assert.equal(summer.timeLabel, 'MT');

  const denver = model.describeEvent({
    ...event,
    tz: 'America/Sao_Paulo',
    starts_at: at('2026-12-01 09:00', 'America/Denver'),
    ends_at: at('2026-12-01 10:00', 'America/Denver')
  }, BEFORE);
  assert.match(denver.primary, /9:00 AM to 10:00 AM/);
  assert.equal(denver.timeLabel, 'MT');
});

test('all-day copy stays on the event dates and does not show midnight clocks', () => {
  const event = {
    starts_at: at('2026-12-01 00:00', 'America/Belem'),
    ends_at: at('2026-12-02 00:00', 'America/Belem'),
    tz: 'America/Belem',
    all_day: true,
    status: 'tentative'
  };
  const described = model.describeEvent(event, AFTER);
  assert.match(described.primary, /All day/);
  assert.match(described.primary, /Dec 1/);
  assert.doesNotMatch(described.primary, /Nov 30|Dec 2|12:00/);
  assert.equal(described.timeLabel, '');
  assert.equal(described.secondary, '');
});

test('all-day events stay on their civil dates in a Denver month', () => {
  const event = {
    id: 'day',
    title: 'Demo all day',
    starts_at: at('2026-12-15 00:00', 'America/Belem'),
    ends_at: at('2026-12-16 00:00', 'America/Belem'),
    tz: 'America/Belem',
    all_day: true,
    status: 'confirmed'
  };
  const grid = model.monthGrid(2026, 12, 'America/Belem', [event], AFTER);
  const byKey = Object.fromEntries(grid.cells.map((cell) => [cell.key, cell]));
  assert.equal(byKey['2026-12-14'].events.length, 0);
  assert.ok(byKey['2026-12-15'].events.some((item) => item.id === 'day'));
  assert.equal(byKey['2026-12-16'].events.length, 0);
  assert.equal(grid.zone, 'America/Denver');
  assert.equal(grid.cells.length, 42);
});

test('today follows Denver when that instant is already the next day in Belem', () => {
  const now = model.zonedInstant(2026, 12, 2, 1, 30, 0, 'America/Belem');
  const grid = model.monthGrid(2026, 12, 'America/Belem', [], now);
  assert.deepEqual(grid.cells.filter((cell) => cell.isToday).map((cell) => cell.key), ['2026-12-01']);
});

test('upcoming groups use Denver dates and keep an in-progress event out of a future day', () => {
  const now = new Date(at('2026-12-01 09:30', 'America/Belem'));
  const events = [
    {
      id: 'now',
      title: 'Demo live',
      starts_at: at('2026-12-01 09:00', 'America/Belem'),
      ends_at: at('2026-12-01 11:00', 'America/Belem'),
      tz: 'America/Belem',
      status: 'confirmed'
    },
    {
      id: 'later',
      title: 'Demo later',
      starts_at: at('2026-12-02 09:00', 'America/Denver'),
      ends_at: at('2026-12-02 10:00', 'America/Denver'),
      tz: 'America/Denver',
      status: 'tentative'
    },
    {
      id: 'late',
      title: 'Demo after midnight in Belem',
      starts_at: at('2026-12-02 00:30', 'America/Belem'),
      ends_at: at('2026-12-02 01:00', 'America/Belem'),
      tz: 'America/Belem',
      status: 'confirmed'
    },
    {
      id: 'gone',
      title: 'Demo cancelled',
      starts_at: at('2026-12-02 09:00', 'America/Belem'),
      ends_at: at('2026-12-02 12:00', 'America/Belem'),
      status: 'cancelled'
    }
  ];
  const grouped = model.upcomingGroups(events, now);
  assert.equal(grouped.zone, 'America/Denver');
  assert.equal(grouped.groups[0].key, 'in-progress');
  assert.deepEqual(grouped.groups[0].events.map((event) => event.id), ['now']);
  assert.equal(grouped.groups[1].key, '2026-12-01');
  assert.equal(grouped.groups[1].label.startsWith('Today'), true);
  assert.deepEqual(grouped.groups[1].events.map((event) => event.id), ['late']);
  assert.equal(grouped.groups[2].key, '2026-12-02');
  assert.equal(grouped.groups[2].label.startsWith('Today'), false);
  assert.deepEqual(grouped.groups[2].events.map((event) => event.id), ['later']);
  assert.equal(grouped.overlaps.has('later'), false);
});

test('an all-day Belem date does not show as in progress on the previous Denver evening', () => {
  const now = new Date(at('2026-12-14 21:00', 'America/Denver'));
  const event = {
    id: 'day',
    title: 'Demo all day',
    starts_at: at('2026-12-15 00:00', 'America/Belem'),
    ends_at: at('2026-12-16 00:00', 'America/Belem'),
    tz: 'America/Belem',
    all_day: true,
    status: 'confirmed'
  };
  const grouped = model.upcomingGroups([event], now);
  assert.equal(grouped.groups.some((group) => group.key === 'in-progress'), false);
  assert.equal(grouped.groups[0].key, '2026-12-15');
});

test('entered times are read as Denver and stored with that zone', () => {
  const winter = model.eventFromDenverFields({
    start: '2026-12-01T09:00',
    end: '2026-12-01T10:00'
  });
  assert.equal(winter.tz, 'America/Denver');
  assert.equal(winter.all_day, false);
  assert.equal(winter.starts_at, at('2026-12-01 09:00', 'America/Denver'));
  assert.equal(winter.ends_at, at('2026-12-01 10:00', 'America/Denver'));
  assert.match(model.describeEvent(winter, BEFORE).primary, /9:00 AM to 10:00 AM/);

  const summer = model.eventFromDenverFields({
    date: '2026-07-01',
    startTime: '09:00',
    endTime: '10:30'
  });
  assert.equal(summer.starts_at, at('2026-07-01 09:00', 'America/Denver'));
  assert.equal(summer.ends_at, at('2026-07-01 10:30', 'America/Denver'));

  const allDay = model.eventFromDenverFields({ date: '2026-12-01', endDate: '2026-12-01', allDay: true });
  assert.equal(allDay.tz, 'America/Denver');
  assert.equal(allDay.all_day, true);
  assert.equal(allDay.starts_at, at('2026-12-01 00:00', 'America/Denver'));
  assert.equal(allDay.ends_at, at('2026-12-02 00:00', 'America/Denver'));
  const saved = { id: 'off', title: 'Demo day off', status: 'confirmed', ...allDay };
  const grid = model.monthGrid(2026, 12, 'America/Belem', [saved], new Date('2026-12-01T18:00:00Z'));
  const byKey = Object.fromEntries(grid.cells.map((cell) => [cell.key, cell]));
  assert.equal(byKey['2026-11-30'].events.length, 0);
  assert.ok(byKey['2026-12-01'].events.some((item) => item.id === 'off'));
  assert.equal(byKey['2026-12-02'].events.length, 0);
  assert.equal(model.eventFromDenverFields({ start: '2026-12-01T09:00:00Z', end: '2026-12-01T10:00:00Z' }), null);
});
