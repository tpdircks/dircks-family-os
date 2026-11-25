/* Calendar tab. Loaded only when that tab is first opened.
 * Renders into #panel-calendar and never touches the finance panel. */
(() => {
  'use strict';

  const model = window.FamilyOSCalendarModel;
  const $ = (id) => document.getElementById(id);

  let token = 0;
  let client = null;
  let cache = null;
  let wired = false;
  let visibleMonth = null;
  let selectedDay = null;

  function text(value) {
    return String(value == null ? '' : value);
  }

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = text(content);
    return node;
  }

  function setStatus(message) {
    const node = $('calendar-status');
    if (node) node.textContent = message || '';
  }

  function showError(message) {
    const node = $('calendar-error');
    if (!node) return;
    if (!message) {
      node.classList.add('is-hidden');
      node.textContent = '';
      return;
    }
    node.textContent = message;
    node.classList.remove('is-hidden');
  }

  function labelWords(value) {
    return text(value).replace(/_/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }

  function currentMonth(now) {
    if (visibleMonth) return visibleMonth;
    const parts = model.zonedParts(now, model.DISPLAY_ZONE);
    visibleMonth = { year: parts.year, month: parts.month };
    return visibleMonth;
  }

  function shiftMonth(delta) {
    const month = currentMonth(new Date());
    const utc = new Date(Date.UTC(month.year, month.month - 1 + delta, 1));
    visibleMonth = { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1 };
    selectedDay = null;
    paint(cache || []);
  }

  function whenLine(described) {
    const line = el('p', 'cal-when');
    line.append(document.createTextNode(described.primary));
    if (described.timeLabel) line.append(el('span', 'tz-label', described.timeLabel));
    return line;
  }

  function eventCard(event, overlaps) {
    const described = model.describeEvent(event, new Date());
    const overlap = overlaps.has(String(event.id));
    const row = el('article', overlap ? 'cal-event is-overlap' : 'cal-event');
    row.append(el('h3', '', event.title || 'Untitled'));
    row.append(whenLine(described));
    if (described.secondary) row.append(el('p', 'cal-when-alt', described.secondary));
    const bits = [
      labelWords(event.category || 'general'),
      labelWords(event.status || 'tentative')
    ];
    if (event.location) bits.push(event.location);
    if (event.source) bits.push(`Added by ${event.source}`);
    row.append(el('p', 'small muted', bits.join(' · ')));
    if (event.notes) row.append(el('p', 'cal-notes', event.notes));
    const href = model.safeHttpsUrl(event.link);
    if (href) {
      const link = el('a', 'cal-link', 'Open link');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
    }
    if (overlap) row.append(el('p', 'cal-flag', 'Overlaps another event'));
    return row;
  }

  function paintMonth(events, now) {
    const host = $('calendar-month');
    const label = $('calendar-month-label');
    if (!host) return;
    const month = currentMonth(now);
    const grid = model.monthGrid(month.year, month.month, model.DISPLAY_ZONE, events, now);
    if (label) label.textContent = grid.label;
    host.replaceChildren();
    for (const weekday of grid.weekdays) host.append(el('div', 'month-dow', weekday));
    for (const cell of grid.cells) {
      const button = el('button', 'month-day');
      button.type = 'button';
      if (!cell.inMonth) button.classList.add('is-outside');
      if (cell.isToday) button.classList.add('is-today');
      if (selectedDay === cell.key) button.classList.add('is-selected');
      const overlap = cell.events.some((event) => event.overlap);
      button.setAttribute('aria-pressed', selectedDay === cell.key ? 'true' : 'false');
      button.setAttribute('aria-label', `${cell.key}, ${cell.events.length} event${cell.events.length === 1 ? '' : 's'}${overlap ? ', overlap' : ''}`);
      button.append(el('span', 'month-num', String(cell.day)));
      for (const event of cell.events.slice(0, 3)) {
        button.append(el('span', event.overlap ? 'month-chip is-overlap' : 'month-chip', event.title));
      }
      if (cell.events.length > 3) button.append(el('span', 'month-more', `+${cell.events.length - 3} more`));
      button.addEventListener('click', () => {
        selectedDay = selectedDay === cell.key ? null : cell.key;
        paint(cache || []);
      });
      host.append(button);
    }
  }

  function paintUpcoming(events, now) {
    const host = $('calendar-upcoming');
    const legend = $('calendar-legend');
    if (!host) return;
    const zone = model.DISPLAY_ZONE;
    const overlaps = model.overlappingIds(events);
    host.replaceChildren();
    if (legend) {
      legend.textContent = overlaps.size
        ? 'A marked row overlaps another event that is not cancelled.'
        : '';
    }
    const cancelled = (events || []).filter((event) => event.status === 'cancelled').length;
    if (selectedDay) {
      const heading = el('div', 'cal-day-head');
      heading.append(el('h3', '', model.formatDayKey(selectedDay, zone, now)));
      const clear = el('button', 'button secondary', 'Show upcoming');
      clear.type = 'button';
      clear.addEventListener('click', () => {
        selectedDay = null;
        paint(cache || []);
      });
      heading.append(clear);
      host.append(heading);
      const rows = model.eventsOnDay(events, selectedDay);
      if (!rows.length) {
        host.append(el('p', 'empty-copy', 'Nothing scheduled on this day.'));
      } else {
        for (const event of rows) host.append(eventCard(event, overlaps));
      }
    } else {
      const grouped = model.upcomingGroups(events, now);
      if (!grouped.groups.length) {
        host.append(el('p', 'empty-copy', events && events.length
          ? 'Nothing coming up. Past events still appear when you pick a day above.'
          : 'No events on the calendar yet. Events added by your bots will show up here.'));
      }
      for (const group of grouped.groups) {
        host.append(el('h3', 'cal-day-label', group.label));
        for (const event of group.events) host.append(eventCard(event, overlaps));
      }
    }
    if (cancelled) {
      host.append(el('p', 'small muted', cancelled === 1
        ? '1 cancelled event is hidden.'
        : `${cancelled} cancelled events are hidden.`));
    }
  }

  function paint(events) {
    const now = new Date();
    const today = $('calendar-today');
    const note = $('calendar-zone-note');
    if (today) {
      today.textContent = new Intl.DateTimeFormat('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: model.DISPLAY_ZONE
      }).format(now).toUpperCase();
    }
    if (note) note.textContent = model.zoneNote(now);
    paintMonth(events || [], now);
    paintUpcoming(events || [], now);
  }

  function wire() {
    if (wired) return;
    wired = true;
    $('calendar-prev')?.addEventListener('click', () => shiftMonth(-1));
    $('calendar-next')?.addEventListener('click', () => shiftMonth(1));
    $('calendar-today-btn')?.addEventListener('click', () => {
      visibleMonth = null;
      selectedDay = null;
      paint(cache || []);
    });
    $('calendar-refresh')?.addEventListener('click', () => {
      const button = $('calendar-refresh');
      button.disabled = true;
      load({ client }).finally(() => { button.disabled = false; });
    });
  }

  async function load(context) {
    const current = ++token;
    client = context?.client || client;
    if (!model) throw new Error('Calendar helpers did not load.');
    wire();
    setStatus('Loading the calendar.');
    showError('');
    if (!client) {
      setStatus('');
      showError('The calendar is not connected yet. The rest of your dashboard is unaffected.');
      paint(cache || []);
      return;
    }
    const { data, error } = await client.schema('family_api')
      .from('calendar_events')
      .select('id,title,starts_at,ends_at,tz,all_day,category,source,location,link,notes,status,created_at,updated_at')
      .order('starts_at', { ascending: true })
      .limit(1000);
    if (current !== token) return;
    if (error) {
      console.error('Calendar request failed.', error);
      setStatus('');
      showError(model.isMissingRelation(error)
        ? 'Calendar storage is not ready yet. The rest of your dashboard is unaffected.'
        : 'The calendar could not be loaded. The rest of your dashboard is unaffected.');
      paint(cache || []);
      return;
    }
    cache = data || [];
    setStatus(cache.length >= 1000 ? 'Showing the first 1,000 events.' : '');
    showError('');
    paint(cache);
  }

  function clear() {
    token += 1;
    cache = null;
    client = null;
    visibleMonth = null;
    selectedDay = null;
    showError('');
    setStatus('');
    const today = $('calendar-today');
    const note = $('calendar-zone-note');
    const label = $('calendar-month-label');
    const legend = $('calendar-legend');
    if (today) today.textContent = '';
    if (note) note.textContent = '';
    if (label) label.textContent = 'Month';
    if (legend) legend.textContent = '';
    $('calendar-month')?.replaceChildren();
    $('calendar-upcoming')?.replaceChildren();
  }

  window.FamilyOSCalendar = { load, clear };
})();
