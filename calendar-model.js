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
  /* Calendar clocks, day columns, and "today" always use Denver. MST/MDT follows the IANA zone. */
  const DISPLAY_ZONE = 'America/Denver';
  const TIME_LABEL = 'MT';

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

  function zoneOrDenver(timeZone) {
    const name = String(timeZone || '').trim();
    if (!name) return DISPLAY_ZONE;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: name }).format(0);
      return name;
    } catch (error) {
      return DISPLAY_ZONE;
    }
  }

  function dateKeyFromParts(parts) {
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  }

  /* All-day rows are midnights in their own tz. Keep those civil dates so Denver
   * conversion cannot move the event onto the previous evening. */
  function allDayDateKeys(event) {
    const times = eventTimes(event);
    if (!times) return [];
    const zone = zoneOrDenver(event && event.tz);
    let cursor;
    let lastKey;
    try {
      cursor = zonedParts(times.start, zone);
      lastKey = dateKeyFromParts(zonedParts(new Date(times.end.getTime() - 1), zone));
    } catch (error) {
      return [];
    }
    const keys = [];
    for (let guard = 0; guard < 400; guard += 1) {
      const key = dateKeyFromParts(cursor);
      keys.push(key);
      if (key === lastKey) break;
      const next = addDays(cursor.year, cursor.month, cursor.day, 1);
      cursor = { year: next.year, month: next.month, day: next.day };
    }
    return keys;
  }

  function civilDayLabel(key) {
    const [year, month, day] = String(key).split('-').map(Number);
    if (!year || !month || !day) return '';
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  }

  function placeUpcoming(event, instant, inProgress, byDay) {
    if (event.all_day) {
      const keys = allDayDateKeys(event);
      const today = dayKey(instant, DISPLAY_ZONE);
      if (!keys.length) return;
      if (keys.indexOf(today) !== -1) {
        inProgress.push(event);
        return;
      }
      const key = keys.find((item) => item > today);
      if (!key) return;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(event);
      return;
    }
    const start = new Date(event.starts_at);
    if (start <= instant) {
      inProgress.push(event);
      return;
    }
    const key = dayKey(start, DISPLAY_ZONE);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
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

  function clockRange(start, end) {
    const timeZone = DISPLAY_ZONE;
    if (dayKey(start, timeZone) === dayKey(end, timeZone)) {
      return `${formatDay(start, timeZone)}, ${formatTime(start, timeZone)} to ${formatTime(end, timeZone)}`;
    }
    return `${formatDay(start, timeZone)}, ${formatTime(start, timeZone)} to ${formatDay(end, timeZone)}, ${formatTime(end, timeZone)}`;
  }

  function describeEvent(event) {
    const viewer = DISPLAY_ZONE;
    const zone = DISPLAY_ZONE;
    const times = eventTimes(event);
    if (!times) return { primary: 'Time not set', secondary: '', timeLabel: '', zonesDiffer: false, viewer, zone };
    let primary = '';
    let timeLabel = '';
    try {
      if (event.all_day) {
        const keys = allDayDateKeys(event);
        if (!keys.length) {
          primary = 'All day';
        } else {
          const startLabel = civilDayLabel(keys[0]);
          const endLabel = civilDayLabel(keys[keys.length - 1]);
          const span = !endLabel || startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;
          primary = `All day ${span}`;
        }
      } else {
        primary = clockRange(times.start, times.end);
        timeLabel = TIME_LABEL;
      }
    } catch (error) {
      primary = 'Time zone unavailable';
      timeLabel = '';
    }
    return { primary, secondary: '', timeLabel, zonesDiffer: false, viewer, zone };
  }

  function formatDayKey(key, _timeZone, now) {
    const [year, month, day] = String(key).split('-').map(Number);
    const utc = new Date(Date.UTC(year, month - 1, day, 12));
    const label = new Intl.DateTimeFormat('en-US', {
      weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC'
    }).format(utc);
    if (now && dayKey(now, DISPLAY_ZONE) === key) return `Today, ${label}`;
    return label;
  }

  function upcomingGroups(events, now) {
    const instant = now instanceof Date ? now : new Date(now || Date.now());
    const zone = DISPLAY_ZONE;
    const overlaps = overlappingIds(events);
    const active = (events || []).filter((event) => {
      const times = eventTimes(event);
      return event && !isCancelled(event) && times && times.end > instant;
    });
    active.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || String(a.id).localeCompare(String(b.id)));
    const inProgress = [];
    const byDay = new Map();
    for (const event of active) placeUpcoming(event, instant, inProgress, byDay);
    const groups = [];
    if (inProgress.length) groups.push({ key: 'in-progress', label: 'In progress', events: inProgress });
    for (const [key, list] of byDay) {
      groups.push({ key, label: formatDayKey(key, zone, instant), events: list });
    }
    return { zone, groups, overlaps };
  }

  function eventsOnDay(events, key) {
    const window = dayWindow(key, DISPLAY_ZONE);
    return (events || []).filter((event) => {
      const times = eventTimes(event);
      if (!event || isCancelled(event) || !times) return false;
      if (event.all_day) return allDayDateKeys(event).indexOf(key) !== -1;
      return times.start < window.end && times.end > window.start;
    }).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at) || String(a.id).localeCompare(String(b.id)));
  }

  function monthGrid(year, month, _timeZone, events, now) {
    const zone = DISPLAY_ZONE;
    const instant = now instanceof Date ? now : new Date(now || Date.now());
    const firstNoon = zonedInstant(year, month, 1, 12, 0, 0, zone);
    const lead = WEEKDAYS.indexOf(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(firstNoon));
    const today = dayKey(instant, zone);
    const overlaps = overlappingIds(events);
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(year, month, 1, index - lead);
      const key = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
      const inMonth = date.month === month && date.year === year;
      const dayEvents = eventsOnDay(events, key);
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
    return { label, zone, weekdays: WEEKDAYS, cells, overlaps };
  }

  function parseDateParts(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return { year, month, day };
  }

  function parseClock(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  function parseDateTimeField(value) {
    const raw = String(value || '').trim();
    if (!raw || /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) return null;
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(raw);
    if (!match) return null;
    const date = parseDateParts(match[1]);
    const clock = parseClock(match[2]);
    if (!date || !clock) return null;
    return { ...date, ...clock };
  }

  /* Naive form values are wall times in Denver, never the device zone. */
  function eventFromDenverFields(input) {
    const source = input || {};
    const allDay = Boolean(source.allDay || source.all_day);
    const startStamp = parseDateTimeField(source.start || source.startsAt);
    const endStamp = parseDateTimeField(source.end || source.endsAt);
    const startDate = startStamp
      ? { year: startStamp.year, month: startStamp.month, day: startStamp.day }
      : parseDateParts(source.date || source.startDate);
    if (!startDate) return null;
    if (allDay) {
      const inclusiveEnd = parseDateParts(source.endDate) || (endStamp
        ? { year: endStamp.year, month: endStamp.month, day: endStamp.day }
        : startDate);
      const start = zonedInstant(startDate.year, startDate.month, startDate.day, 0, 0, 0, DISPLAY_ZONE);
      const next = addDays(inclusiveEnd.year, inclusiveEnd.month, inclusiveEnd.day, 1);
      const end = zonedInstant(next.year, next.month, next.day, 0, 0, 0, DISPLAY_ZONE);
      if (end <= start) return null;
      return { starts_at: start.toISOString(), ends_at: end.toISOString(), tz: DISPLAY_ZONE, all_day: true };
    }
    const startClock = startStamp || parseClock(source.startTime);
    const endClock = endStamp || parseClock(source.endTime);
    const endDate = endStamp
      ? { year: endStamp.year, month: endStamp.month, day: endStamp.day }
      : (parseDateParts(source.endDate) || startDate);
    if (!startClock || !endClock || !endDate) return null;
    const start = zonedInstant(
      startDate.year, startDate.month, startDate.day, startClock.hour, startClock.minute, 0, DISPLAY_ZONE
    );
    const end = zonedInstant(
      endDate.year, endDate.month, endDate.day, endClock.hour, endClock.minute, 0, DISPLAY_ZONE
    );
    if (end <= start) return null;
    return { starts_at: start.toISOString(), ends_at: end.toISOString(), tz: DISPLAY_ZONE, all_day: false };
  }

  function zoneNote() {
    return 'Times are Mountain Time (MT). Today and each day follow America/Denver.';
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
    DISPLAY_ZONE,
    TIME_LABEL,
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
    eventFromDenverFields,
    formatDayKey,
    upcomingGroups,
    eventsOnDay,
    monthGrid,
    zoneNote,
    isMissingRelation,
    safeHttpsUrl
  };
});
