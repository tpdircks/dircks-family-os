import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const book = createRequire(import.meta.url)('../book-model.js');

test('stage counts keep every normalized stage, including zeros', () => {
  const rows = [
    { stage: 'found' },
    { stage: 'Pending Approval' },
    { stage: 'pending-approval' },
    { stage: 'booked' },
    { stage: 'mystery' }
  ];
  const summary = book.stageCounts(rows);
  assert.equal(summary.counts.found, 1);
  assert.equal(summary.counts.pending_approval, 2);
  assert.equal(summary.counts.drafted, 0);
  assert.equal(summary.counts.sent, 0);
  assert.equal(summary.counts.replied, 0);
  assert.equal(summary.counts.booked, 1);
  assert.equal(summary.counts.skipped, 0);
  assert.equal(summary.other, 1);
  assert.deepEqual(summary.tiles.map((tile) => tile.id), [
    'found', 'drafted', 'pending_approval', 'sent', 'replied', 'booked', 'skipped', 'other'
  ]);
});

test('recent outreach is the 15 newest rows and ignores older ones', () => {
  const rows = Array.from({ length: 16 }, (_, index) => ({
    id: `EM-2026-11-15-${String(index).padStart(2, '0')}`,
    date_found: '2026-11-15',
    updated_at: new Date(Date.UTC(2026, 10, 15, 0, index)).toISOString(),
    place: 'Example place'
  }));
  const recent = book.recentOutreach(rows, 15);
  assert.equal(recent.length, 15);
  assert.equal(recent[0].id, 'EM-2026-11-15-15');
  assert.equal(recent.some((row) => row.id === 'EM-2026-11-15-00'), false);
});

test('booked appearances are podcast and interview rows that are not cancelled', () => {
  const events = [
    { id: 'p', category: 'Podcast', status: 'confirmed', starts_at: '2026-12-02T15:00:00Z', ends_at: '2026-12-02T16:00:00Z' },
    { id: 'i', category: 'interview', status: 'tentative', starts_at: '2026-12-01T15:00:00Z', ends_at: '2026-12-01T16:00:00Z' },
    { id: 'x', category: 'interview', status: 'cancelled', starts_at: '2026-12-03T15:00:00Z', ends_at: '2026-12-03T16:00:00Z' },
    { id: 'o', category: 'planning', status: 'confirmed', starts_at: '2026-12-01T12:00:00Z', ends_at: '2026-12-01T13:00:00Z' }
  ];
  assert.deepEqual(book.bookedAppearances(events).map((event) => event.id), ['i', 'p']);
});

test('date-only values do not shift across a time zone', () => {
  assert.equal(book.formatDateOnly('2026-11-15'), 'Nov 15, 2026');
  assert.equal(book.formatDateOnly(''), '');
  assert.equal(book.safeHttpUrl('https://example.com/demo-show'), 'https://example.com/demo-show');
  assert.equal(book.safeHttpUrl('javascript:alert(1)'), '');
});

test('books keep Elite Mindset published and add Signal Over Noise pre-launch', () => {
  assert.deepEqual(book.BOOKS.map((entry) => entry.id), ['elite_mindset', 'signal_over_noise']);
  const elite = book.viewFor('elite_mindset');
  assert.equal(elite.heading, 'Elite Mindset Book.');
  assert.equal(elite.lead, 'Booked podcasts and interviews, and where outreach stands.');
  assert.equal(elite.showNotes, true);
  assert.equal(elite.showAppearances, true);
  assert.equal(elite.prelaunch, false);
  assert.equal(elite.outreachHeading, 'Outreach');
  const signal = book.viewFor('Signal Over Noise');
  assert.equal(signal.id, 'signal_over_noise');
  assert.equal(signal.heading, 'Signal Over Noise.');
  assert.equal(signal.lead, 'Signal Over Noise is about telling signal from noise in life. Signal raises the level you live at, and noise holds you below it.');
  assert.equal(signal.prelaunch, true);
  assert.equal(signal.showNotes, false);
  assert.equal(signal.showAppearances, false);
  assert.equal(signal.outreachHeading, 'Presale and marketing');
  assert.equal(signal.launchOn, '2026-12-29');
  assert.equal(book.viewFor('missing').id, 'elite_mindset');
  assert.equal(book.launchCountdown('elite_mindset', new Date('2026-11-23T15:00:00Z'), 'America/Belem'), null);
});

test('outreach rows with no book stay on Elite Mindset', () => {
  const rows = [
    { id: 'EM-1', book: null },
    { id: 'EM-2' },
    { id: 'EM-3', book: '  ' },
    { id: 'EM-4', book: 'Elite Mindset' },
    { id: 'SON-1', book: 'signal_over_noise' },
    { id: 'SON-2', book: 'SON' },
    { id: 'X-1', book: 'other_title' }
  ];
  assert.deepEqual(book.rowsForBook(rows, 'elite_mindset').map((row) => row.id), ['EM-1', 'EM-2', 'EM-3', 'EM-4']);
  assert.deepEqual(book.rowsForBook(rows, 'signal_over_noise').map((row) => row.id), ['SON-1', 'SON-2']);
  assert.deepEqual(book.rowsForBook(rows, 'elite_mindset').map((row) => row.id).includes('SON-1'), false);
});

test('a missing book column is not treated as missing outreach storage', () => {
  const column = {
    code: 'PGRST204',
    message: "Could not find the 'book' column of 'book_outreach' in the schema cache"
  };
  const relation = {
    code: 'PGRST205',
    message: "Could not find the table 'family_api.book_outreach' in the schema cache"
  };
  assert.equal(book.isMissingColumn(column, 'book'), true);
  assert.equal(book.isMissingRelation(column), false);
  assert.equal(book.isMissingColumn({ code: '42703', message: 'column "book" does not exist' }, 'book'), true);
  assert.equal(book.isMissingRelation({ code: '42703', message: 'column "book" does not exist' }), false);
  assert.equal(book.isMissingColumn(relation, 'book'), false);
  assert.equal(book.isMissingRelation(relation), true);
  assert.equal(book.isMissingColumn(null, 'book'), false);
});

test('Signal Over Noise countdown and milestones use the launch dates', () => {
  const now = new Date('2026-11-23T15:00:00Z');
  const countdown = book.launchCountdown('signal_over_noise', now, 'America/Belem');
  assert.equal(countdown.today, '2026-11-23');
  assert.equal(countdown.days, 36);
  assert.equal(countdown.number, '36');
  assert.equal(countdown.note, 'days to launch');
  assert.equal(countdown.launchLabel, 'Dec 29, 2026');
  assert.equal(countdown.spoken.includes('—'), false);
  const milestones = book.milestonePlan('signal_over_noise', now, 'America/Belem');
  assert.deepEqual(milestones.map((item) => item.id), ['manuscript', 'launch']);
  assert.equal(milestones[0].label, 'Manuscript final');
  assert.equal(milestones[0].dateLabel, 'Dec 5, 2026');
  assert.equal(milestones[0].month, 'DEC');
  assert.equal(milestones[0].day, '5');
  assert.equal(milestones[0].days, 12);
  assert.equal(milestones[0].status, 'In 12 days');
  assert.equal(milestones[1].status, 'In 36 days');
  assert.equal(milestones[1].on, '2026-12-29');
});

test('countdown follows the time zone and the launch day', () => {
  const edge = new Date('2026-12-29T06:30:00Z');
  const belem = book.launchCountdown('son', edge, 'America/Belem');
  const denver = book.launchCountdown('signal_over_noise', edge, 'America/Denver');
  assert.equal(belem.today, '2026-12-29');
  assert.equal(belem.days, 0);
  assert.equal(belem.number, 'Today');
  assert.equal(belem.note, 'Launch day');
  assert.equal(denver.today, '2026-12-28');
  assert.equal(denver.days, 1);
  assert.equal(denver.number, '1');
  assert.equal(denver.note, 'day to launch');
  const after = book.launchCountdown('signal_over_noise', new Date('2026-12-30T18:00:00Z'), 'America/Denver');
  assert.equal(after.days, -1);
  assert.equal(after.number, 'Launched');
  assert.equal(after.note, 'Dec 29, 2026');
  const done = book.milestonePlan('signal_over_noise', new Date('2026-12-06T18:00:00Z'), 'America/Denver');
  assert.equal(done[0].status, 'Done');
  assert.equal(done[0].tone, 'done');
  assert.equal(done[1].status, 'In 23 days');
});
