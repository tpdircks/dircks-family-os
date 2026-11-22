/* Pure helpers for the Elite Mindset Book tab.
 * No network, no DOM, no personal data. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FamilyOSBookModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

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
    const message = String(error.message || error.details || '');
    const status = Number(error.status);
    return code === 'PGRST205' || code === '42P01' || code === 'PGRST116'
      || status === 404
      || /does not exist|schema cache|could not find the (table|relation)|not found/i.test(message);
  }

  return {
    STAGES,
    BOOKED_CATEGORIES,
    normalizeStage,
    stageLabel,
    stageCounts,
    recentOutreach,
    bookedAppearances,
    formatDateOnly,
    safeHttpUrl,
    isMissingRelation
  };
});
