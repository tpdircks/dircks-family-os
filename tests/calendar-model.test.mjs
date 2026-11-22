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

test('descriptions use the event zone and add Troy\'s zone only when it differs', () => {
  const event = {
    title: 'Demo block',
    starts_at: at('2026-12-01 09:00', 'America/Belem'),
    ends_at: at('2026-12-01 10:00', 'America/Belem'),
    tz: 'America/Belem',
    all_day: false,
    status: 'confirmed'
  };
  const home = model.describeEvent(event, BEFORE);
  assert.match(home.primary, /9:00 AM to 10:00 AM/);
  assert.match(home.primary, /Belem/);
  assert.equal(home.secondary, '');

  const away = {
    ...event,
    tz: 'America/Denver',
    starts_at: at('2026-12-01 09:00', 'America/Denver'),
    ends_at: at('2026-12-01 10:00', 'America/Denver')
  };
  const split = model.describeEvent(away, BEFORE);
  assert.match(split.primary, /Denver/);
  assert.match(split.secondary, /^In Belem:/);
  assert.doesNotMatch(`${split.primary} ${split.secondary}`, /—/);
});

test('all-day copy stays on the event dates and does not show midnight clocks', () => {
  const event = {
    starts_at: at('2026-12-01 00:00', 'America/Belem'),
    ends_at: at('2026-12-02 00:00', 'America/Belem'),
    tz: 'America/Belem',
    all_day: true,
    status: 'tentative'
  };
  const described = model.describeEvent(event, BEFORE);
  assert.match(described.primary, /All day/);
  assert.match(described.primary, /Dec 1/);
  assert.doesNotMatch(described.primary, /12:00/);
  assert.equal(described.secondary, '');
});

test('month cells follow the viewer zone, including an all-day Belem date seen from Denver', () => {
  const event = {
    id: 'day',
    title: 'Demo all day',
    starts_at: at('2026-12-15 00:00', 'America/Belem'),
    ends_at: at('2026-12-16 00:00', 'America/Belem'),
    tz: 'America/Belem',
    all_day: true,
    status: 'confirmed'
  };
  const grid = model.monthGrid(2026, 12, 'America/Denver', [event], AFTER);
  const byKey = Object.fromEntries(grid.cells.map((cell) => [cell.key, cell]));
  assert.ok(byKey['2026-12-14'].events.some((item) => item.id === 'day'));
  assert.ok(byKey['2026-12-15'].events.some((item) => item.id === 'day'));
  assert.equal(byKey['2026-12-16'].events.length, 0);
  assert.equal(grid.cells.length, 42);
});

test('upcoming groups use Troy\'s zone and keep an in-progress event out of a future day', () => {
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
      id: 'gone',
      title: 'Demo cancelled',
      starts_at: at('2026-12-02 09:00', 'America/Belem'),
      ends_at: at('2026-12-02 12:00', 'America/Belem'),
      status: 'cancelled'
    }
  ];
  const grouped = model.upcomingGroups(events, now);
  assert.equal(grouped.zone, 'America/Belem');
  assert.equal(grouped.groups[0].key, 'in-progress');
  assert.deepEqual(grouped.groups[0].events.map((event) => event.id), ['now']);
  assert.equal(grouped.groups[1].key, '2026-12-02');
  assert.equal(grouped.groups[1].label.startsWith('Today'), false);
  assert.deepEqual(grouped.groups[1].events.map((event) => event.id), ['later']);
  assert.equal(grouped.overlaps.has('later'), false);
});
