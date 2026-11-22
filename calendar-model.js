/* Pure helpers for the Calendar tab.
 * No network, no DOM, no personal data. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FamilyOSCalendarModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* 2026-12-14 00:00 in America/Belem (UTC-3, no daylight saving). */
  const TROY_ZONE_SWITCH = '2026-12-14T03:00:00.000Z';
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ZONE_LABELS = {
    'America/Belem': 'Belem',
    'America/Denver': 'Denver'
  };

  function troyZone(now) {
    const instant = now instanceof Date ? now : new Date(now || Date.now());
    if (Number.isNaN(instant.getTime())) return 'America/Belem';
    return instant.getTime() < Date.parse(TROY_ZONE_SWITCH) ? 'America/Belem' : 'America/Denver';
  }

  function zoneLabel(timeZone) {
    if (ZONE_LABELS[timeZone]) return ZONE_LABELS[timeZone];
    const tail = String(timeZone || '').split('/').pop() || 'Local';
    return tail.replace(/_/g, ' ');
  }

  function zonedParts(date, timeZone) {
    const instant = date instanceof Date ? date : new Date(date);
    const format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const bag = {};
    for (const part of format.formatToParts(instant)) {
      if (part.type !== 'literal') bag[part.type] = part.value;
    }
    return {
      year: Number(bag.year),
      month: Number(bag.month),
      day: Number(bag.day),
      hour: Number(bag.hour) % 24,
      minute: Number(bag.minute),
      second: Number(bag.second)
    };
  }

  function dayKey(date, timeZone) {
    const parts = zonedParts(date, timeZone);
    const pad = (value) => String(value).padStart(2, '0');
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  }

  function addDays(year, month, day, delta) {
    const utc = new Date(Date.UTC(year, month - 1, day + delta));
    return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function zonedInstant(year, month, day, hour, minute, second, timeZone) {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second || 0);
    const offsetAt = (ms) => {
      const parts = zonedParts(new Date(ms), timeZone);
      const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      return asUtc - ms;
    };
    let ms = utcGuess - offsetAt(utcGuess);
    ms = utcGuess - offsetAt(ms);
    return new Date(ms);
  }

  function dayWindow(key, timeZone) {
    const [year, month, day] = String(key).split('-').map(Number);
    const start = zonedInstant(year, month, day, 0, 0, 0, timeZone);
    const next = addDays(year, month, day, 1);
    const end = zonedInstant(next.year, next.month, next.day, 0, 0, 0, timeZone);
    return { start, end };
  }

  function eventTimes(event) {
    const start = new Date(event && event.starts_at);
    const end = new Date(event && event.ends_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
    return { start, end };
  }

  function rangesOverlap(a, b) {
    const left = eventTimes(a);
    const right = eventTimes(b);
    if (!left || !right) return false;
    return left.start < right.end && left.end > right.start;
  }

  function isCancelled(event) {
    return String(event && event.status || '') === 'cancelled';
  }

  function overlappingIds(events) {
    const active = (events || []).filter((event) => event && !isCancelled(event) && eventTimes(event));
    const ids = new Set();
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        if (!rangesOverlap(active[i], active[j])) continue;
        ids.add(String(active[i].id));
        ids.add(String(active[j].id));
      }
    }
    return ids;
  }

  function formatDay(date, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', month: 'short', day: 'numeric'
    }).format(date);
  }

  function formatTime(date, timeZone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone, hour: 'numeric', minute: '2-digit'
    }).format(date);
  }

  function zonePhrase(date, timeZone) {
    let abbr = '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(date);
      abbr = (parts.find((part) => part.type === 'timeZoneName') || {}).value || '';
    } catch (error) {
      abbr = '';
    }
    const label = zoneLabel(timeZone);
    return abbr ? `${label}, ${abbr}` : label;
  }

  function clockRange(start, end, timeZone) {
    if (dayKey(start, timeZone) === dayKey(end, timeZone)) {
      return `${formatDay(start, timeZone)}, ${formatTime(start, timeZone)} to ${formatTime(end, timeZone)}`;
    }
    return `${formatDay(start, timeZone)}, ${formatTime(start, timeZone)} to ${formatDay(end, timeZone)}, ${formatTime(end, timeZone)}`;
  }

  function describeEvent(event, now) {
    const viewer = troyZone(now);
    const zone = event && event.tz ? String(event.tz) : viewer;
    const times = eventTimes(event);
    if (!times) return { primary: 'Time not set', secondary: '', zonesDiffer: false, viewer, zone };
    let primary = '';
    let secondary = '';
    let zonesDiffer = false;
    try {
      zonesDiffer = zone !== viewer;
      if (event.all_day) {
        const last = new Date(times.end.getTime() - 1);
        const startLabel = formatDay(times.start, zone);
        const endLabel = formatDay(last, zone);
        const span = startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;
        primary = `All day ${span} (${zonePhrase(times.start, zone)})`;
        if (zonesDiffer) secondary = `In ${zoneLabel(viewer)}: ${clockRange(times.start, times.end, viewer)}`;
      } else {
        primary = `${clockRange(times.start, times.end, zone)} (${zonePhrase(times.start, zone)})`;
        if (zonesDiffer) secondary = `In ${zoneLabel(viewer)}: ${clockRange(times.start, times.end, viewer)}`;
      }
    } catch (error) {
      primary = 'Time zone unavailable';
      secondary = '';
      zonesDiffer = false;
    }
    return { primary, secondary, zonesDiffer, viewer, zone };
  }

  function formatDayKey(key, timeZone, now) {
    const [year, month, day] = String(key).split('-').map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day, 12));
    const label = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC'
    }).format(utc);
    if (now && dayKey(now, timeZone) === key) return `Today, ${label}`;
    return label;
  }

  function upcomingGroups(events, now) {
    const instant = now instanceof Date ? now : new Date(now || Date.now());
    const zone = troyZone(instant);
    const overlaps = overlappingIds(events);
    const active = (events || []).filter((event) => {
      const times = eventTimes(event);
      return event && !isCancelled(event) && times && times.end > instant;
    });
    active.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || String(a.id).localeCompare(String(b.id)));
    const inProgress = [];
    const byDay = new Map();
    for (const event of active) {
      const start = new Date(event.starts_at);
      if (start <= instant) {
        inProgress.push(event);
        continue;
      }
      const key = dayKey(start, zone);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(event);
    }
    const groups = [];
    if (inProgress.length) groups.push({ key: 'in-progress', label: 'In progress', events: inProgress });
    for (const [key, list] of byDay) {
      groups.push({ key, label: formatDayKey(key, zone, instant), events: list });
    }
    return { zone, groups, overlaps };
  }

  function eventsOnDay(events, key, timeZone) {
    const window = dayWindow(key, timeZone);
    return (events || []).filter((event) => {
      const times = eventTimes(event);
      if (!event || isCancelled(event) || !times) return false;
      return times.start < window.end && times.end > window.start;
    }).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || String(a.id).localeCompare(String(b.id)));
  }

  function monthGrid(year, month, timeZone, events, now) {
    const instant = now instanceof Date ? now : new Date(now || Date.now());
    const firstNoon = zonedInstant(year, month, 1, 12, 0, 0, timeZone);
    const lead = WEEKDAYS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(firstNoon));
    const today = dayKey(instant, timeZone);
    const overlaps = overlappingIds(events);
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(year, month, 1, index - lead);
      const key = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
      const inMonth = date.month === month && date.year === year;
      const dayEvents = eventsOnDay(events, key, timeZone);
      cells.push({
        key,
        day: date.day,
        inMonth,
        isToday: key === today,
        events: dayEvents.map((event) => ({
          id: String(event.id),
          title: String(event.title || 'Untitled'),
          overlap: overlaps.has(String(event.id))
        }))
      });
    }
    const label = new Intl.DateTimeFormat('en-US', {
      month: 'long', year: 'numeric', timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
    return { label, zone: timeZone, weekdays: WEEKDAYS, cells, overlaps };
  }

  function zoneNote(now) {
    const zone = troyZone(now);
    if (zone === 'America/Belem') {
      return 'Your current zone is Belem through December 13, 2026, then Denver. Each event is shown in its own zone, and in your current zone when those differ.';
    }
    return 'Your current zone is Denver. Each event is shown in its own zone, and in Denver when those differ.';
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

  function safeHttpsUrl(value) {
    const url = String(value || '').trim();
    if (!/^https:\/\/\S+$/i.test(url)) return '';
    return url;
  }

  return {
    TROY_ZONE_SWITCH,
    WEEKDAYS,
    troyZone,
    zoneLabel,
    zonedParts,
    dayKey,
    zonedInstant,
    dayWindow,
    rangesOverlap,
    overlappingIds,
    describeEvent,
    formatDayKey,
    upcomingGroups,
    eventsOnDay,
    monthGrid,
    zoneNote,
    isMissingRelation,
    safeHttpsUrl
  };
});
