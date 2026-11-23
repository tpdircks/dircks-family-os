/* Pure helpers for the Books tab.
 * Elite Mindset stays the published view. Signal Over Noise is pre-launch.
 * No network, no DOM, no personal data.
 * Add a milestone with { id, label, on: 'YYYY-MM-DD' }. launchOn is the countdown. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FamilyOSBookModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DEFAULT_BOOK_ID = 'elite_mindset';
  const NOTES_URL = 'https://cursor.com/canvas/store-9aec255a-e639-4083-8ff7-a819972f266b/6374ddf5-dfbb-4d55-afb9-e43d0c8e62e9';
  const BOOKS = [
    {
      id: 'elite_mindset',
      label: 'Elite Mindset',
      heading: 'Elite Mindset Book.',
      lead: 'Booked podcasts and interviews, and where outreach stands.',
      mode: 'published',
      notesUrl: NOTES_URL,
      outreachHeading: 'Outreach'
    },
    {
      id: 'signal_over_noise',
      label: 'Signal Over Noise',
      heading: 'Signal Over Noise.',
      lead: 'Signal Over Noise is about telling signal from noise in life. Signal raises the level you live at, and noise holds you below it.',
      mode: 'prelaunch',
      launchOn: '2026-12-29',
      milestones: [
        { id: 'manuscript', label: 'Manuscript final', on: '2026-12-05' },
        { id: 'launch', label: 'Launch', on: '2026-12-29' }
      ],
      outreachHeading: 'Presale and marketing'
    }
  ];
  const BOOK_ALIASES = {
    elite_mindset: 'elite_mindset',
    em: 'elite_mindset',
    elite: 'elite_mindset',
    signal_over_noise: 'signal_over_noise',
    son: 'signal_over_noise'
  };
  const STAGES = [
    ['found', 'Found'],
    ['drafted', 'Drafted'],
    ['pending_approval', 'Pending approval'],
    ['sent', 'Sent'],
    ['replied', 'Replied'],
    ['booked', 'Booked'],
    ['skipped', 'Skipped']
  ];
  const STAGE_IDS = new Set(STAGES.map(([id]) => id));
  const BOOKED_CATEGORIES = new Set(['podcast', 'interview']);

  function normalizeStage(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function stageLabel(value) {
    const stage = normalizeStage(value);
    const match = STAGES.find(([id]) => id === stage);
    return match ? match[1] : (stage ? stage.replace(/_/g, ' ') : 'Unknown');
  }

  function stageCounts(rows) {
    const counts = Object.fromEntries(STAGES.map(([id]) => [id, 0]));
    let other = 0;
    for (const row of rows || []) {
      const stage = normalizeStage(row && row.stage);
      if (STAGE_IDS.has(stage)) counts[stage] += 1;
      else other += 1;
    }
    const tiles = STAGES.map(([id, label]) => ({ id, label, count: counts[id] }));
    if (other) tiles.push({ id: 'other', label: 'Other', count: other });
    return { counts, other, tiles };
  }

  function recentOutreach(rows, limit) {
    const cap = Number.isFinite(limit) ? limit : 15;
    return [...(rows || [])].sort((a, b) => {
      const updated = (Date.parse(b && b.updated_at) || 0) - (Date.parse(a && a.updated_at) || 0);
      if (updated) return updated;
      const found = String(b && b.date_found || '').localeCompare(String(a && a.date_found || ''));
      if (found) return found;
      return String(b && b.id || '').localeCompare(String(a && a.id || ''));
    }).slice(0, cap);
  }

  function bookedAppearances(events) {
    return (events || []).filter((event) => {
      const category = String(event && event.category || '').trim().toLowerCase();
      return BOOKED_CATEGORIES.has(category) && String(event.status || '') !== 'cancelled';
    }).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || String(a.id).localeCompare(String(b.id)));
  }

  function formatDateOnly(value) {
    const day = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
    const [year, month, date] = day.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, date, 12)));
  }

  function safeHttpUrl(value) {
    const url = String(value || '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return '';
    return url;
  }

  function isMissingRelation(error) {
    if (!error) return false;
    const code = String(error.code || '');
    const message = String(error.message || error.details || error.hint || '');
    const status = Number(error.status);
    if (code === '42703' || code === 'PGRST204') return false;
    if (/could not find the ['"]?[a-z0-9_]+['"]? column|column ['"]?[a-z0-9_]+['"]? (of .+ )?does not exist/i.test(message)) {
      return false;
    }
    return code === 'PGRST205' || code === '42P01' || code === 'PGRST116'
      || status === 404
      || /does not exist|schema cache|could not find the (table|relation)|not found/i.test(message);
  }

  function normalizeBook(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function canonicalBook(value) {
    return BOOK_ALIASES[normalizeBook(value)] || '';
  }

  function bookById(id) {
    const canonical = canonicalBook(id);
    return BOOKS.find((entry) => entry.id === canonical) || null;
  }

  function viewFor(id) {
    const entry = bookById(id) || BOOKS[0];
    const prelaunch = entry.mode === 'prelaunch';
    return {
      id: entry.id,
      label: entry.label,
      heading: entry.heading,
      lead: entry.lead,
      prelaunch,
      showNotes: Boolean(entry.notesUrl),
      showAppearances: !prelaunch,
      notesUrl: entry.notesUrl || '',
      outreachHeading: entry.outreachHeading || 'Outreach',
      launchOn: entry.launchOn || ''
    };
  }

  /* A blank book value stays on Elite Mindset, including before the column exists.
   * A value this tab does not know stays off both books. */
  function rowsForBook(rows, bookId) {
    const wanted = canonicalBook(bookId) || DEFAULT_BOOK_ID;
    return (rows || []).filter((row) => {
      const raw = row && row.book;
      const canonical = canonicalBook(raw);
      if (!canonical) return !String(raw == null ? '' : raw).trim() && wanted === DEFAULT_BOOK_ID;
      return canonical === wanted;
    });
  }

  function isMissingColumn(error, column) {
    if (!error || !column) return false;
    const code = String(error.code || '');
    const message = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`;
    if (!new RegExp(`\\b${column}\\b`, 'i').test(message)) return false;
    if (code === '42703' || code === 'PGRST204') return true;
    return /does not exist|schema cache|could not find/i.test(message);
  }

  function dayKeyInZone(now, timeZone) {
    const instant = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(instant.getTime())) return '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(instant);
      const bag = {};
      for (const part of parts) bag[part.type] = part.value;
      if (!bag.year || !bag.month || !bag.day) return '';
      return `${bag.year}-${bag.month}-${bag.day}`;
    } catch (error) {
      return '';
    }
  }

  function dayUtc(value) {
    const day = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const [year, month, date] = day.split('-').map(Number);
    if (month < 1 || month > 12 || date < 1 || date > 31) return null;
    return Date.UTC(year, month - 1, date);
  }

  function daysBetween(fromKey, toKey) {
    const from = dayUtc(fromKey);
    const to = dayUtc(toKey);
    if (from == null || to == null) return null;
    return Math.round((to - from) / 86400000);
  }

  function dayParts(value) {
    const day = String(value || '').slice(0, 10);
    const utc = dayUtc(day);
    if (utc == null) return { month: '', day: '', label: '' };
    const [, month, date] = day.split('-').map(Number);
    const monthName = new Intl.DateTimeFormat('en-US', {
      month: 'short', timeZone: 'UTC'
    }).format(new Date(utc + 12 * 60 * 60 * 1000));
    return { month: monthName.toUpperCase(), day: String(date), label: formatDateOnly(day) };
  }

  function countdownCopy(days, launchLabel) {
    if (days > 1) return { number: String(days), note: 'days to launch' };
    if (days === 1) return { number: '1', note: 'day to launch' };
    if (days === 0) return { number: 'Today', note: 'Launch day' };
    return { number: 'Launched', note: launchLabel };
  }

  function launchCountdown(bookId, now, timeZone) {
    const entry = bookById(bookId);
    if (!entry || !entry.launchOn) return null;
    const today = dayKeyInZone(now, timeZone);
    const days = daysBetween(today, entry.launchOn);
    if (!today || days == null) return null;
    const launchLabel = formatDateOnly(entry.launchOn);
    const copy = countdownCopy(days, launchLabel);
    const spoken = /^\d+$/.test(copy.number) ? `${copy.number} ${copy.note}` : `${copy.number}. ${copy.note}`;
    return {
      days,
      today,
      launchOn: entry.launchOn,
      launchLabel,
      number: copy.number,
      note: copy.note,
      spoken
    };
  }

  function milestoneStatus(days) {
    if (days == null) return { status: 'Date not set', tone: 'upcoming' };
    if (days > 1) return { status: `In ${days} days`, tone: 'upcoming' };
    if (days === 1) return { status: 'Tomorrow', tone: 'upcoming' };
    if (days === 0) return { status: 'Today', tone: 'today' };
    return { status: 'Done', tone: 'done' };
  }

  function milestonePlan(bookId, now, timeZone) {
    const entry = bookById(bookId);
    if (!entry) return [];
    const today = dayKeyInZone(now, timeZone);
    return [...(entry.milestones || [])]
      .sort((a, b) => String(a && a.on || '').localeCompare(String(b && b.on || ''))
        || String(a && a.label || '').localeCompare(String(b && b.label || '')))
      .map((item) => {
        const on = String(item && item.on || '');
        const parts = dayParts(on);
        const state = milestoneStatus(today ? daysBetween(today, on) : null);
        return {
          id: item && item.id || '',
          label: item && item.label || 'Milestone',
          on,
          dateLabel: parts.label,
          month: parts.month,
          day: parts.day,
          days: today ? daysBetween(today, on) : null,
          status: state.status,
          tone: state.tone
        };
      });
  }

  return {
    STAGES,
    BOOKED_CATEGORIES,
    BOOKS,
    DEFAULT_BOOK_ID,
    normalizeStage,
    stageLabel,
    stageCounts,
    recentOutreach,
    bookedAppearances,
    formatDateOnly,
    safeHttpUrl,
    isMissingRelation,
    normalizeBook,
    canonicalBook,
    bookById,
    viewFor,
    rowsForBook,
    isMissingColumn,
    dayKeyInZone,
    daysBetween,
    launchCountdown,
    milestonePlan
  };
});
