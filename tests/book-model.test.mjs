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
