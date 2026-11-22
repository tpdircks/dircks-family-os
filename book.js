/* Elite Mindset Book tab. Loaded only when that tab is first opened.
 * Renders into #panel-book and never touches the finance panel. */
(() => {
  'use strict';

  const book = window.FamilyOSBookModel;
  const calendar = window.FamilyOSCalendarModel;
  const $ = (id) => document.getElementById(id);
  const NOTES_URL = 'https://cursor.com/canvas/store-9aec255a-e639-4083-8ff7-a819972f266b/6374ddf5-dfbb-4d55-afb9-e43d0c8e62e9';

  let token = 0;
  let client = null;
  let wired = false;
  let appearances = [];
  let outreach = [];

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
    const node = $('book-status');
    if (node) node.textContent = message || '';
  }

  function showError(message) {
    const node = $('book-error');
    if (!node) return;
    if (!message) {
      node.classList.add('is-hidden');
      node.textContent = '';
      return;
    }
    node.textContent = message;
    node.classList.remove('is-hidden');
  }

  function empty(host, message) {
    if (!host) return;
    host.replaceChildren(el('p', 'empty-copy', message));
  }

  function labelWords(value) {
    return text(value).replace(/_/g, ' ').replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }

  function paintAppearances(rows, state) {
    const host = $('book-appearances');
    if (!host) return;
    host.replaceChildren();
    if (state === 'missing') {
      empty(host, 'Booked podcasts and interviews will show here once the calendar is ready.');
      return;
    }
    if (state === 'error') {
      empty(host, 'Booked appearances could not be loaded. The rest of this page is unaffected.');
      return;
    }
    const list = book.bookedAppearances(rows);
    if (!list.length) {
      empty(host, 'No podcasts or interviews are booked yet.');
      return;
    }
    const now = new Date();
    const upcoming = list.filter((event) => new Date(event.ends_at) >= now);
    const earlier = list.filter((event) => new Date(event.ends_at) < now).slice(-10);
    const paintGroup = (title, events) => {
      if (!events.length) return;
      host.append(el('h3', 'cal-day-label', title));
      for (const event of events) {
        const described = calendar.describeEvent(event, now);
        const card = el('article', 'cal-event');
        card.append(el('h3', '', event.title || 'Untitled'));
        card.append(el('p', 'cal-when', described.primary));
        if (described.secondary) card.append(el('p', 'cal-when-alt', described.secondary));
        const bits = [labelWords(event.category), labelWords(event.status)];
        if (event.location) bits.push(event.location);
        card.append(el('p', 'small muted', bits.filter(Boolean).join(' · ')));
        if (event.notes) card.append(el('p', 'cal-notes', event.notes));
        host.append(card);
      }
    };
    paintGroup('Coming up', upcoming);
    paintGroup('Earlier', earlier);
  }

  function paintStages(rows) {
    const host = $('book-stages');
    if (!host) return;
    host.replaceChildren();
    for (const tile of book.stageCounts(rows).tiles) {
      const node = el('div', 'stage-tile');
      node.append(el('span', '', tile.label), el('strong', '', String(tile.count)));
      host.append(node);
    }
  }

  function paintTable(rows, state) {
    const body = $('book-rows');
    const note = $('book-table-note');
    if (!body) return;
    body.replaceChildren();
    if (state === 'missing') {
      if (note) note.textContent = 'Outreach storage is not ready yet.';
      return;
    }
    if (state === 'error') {
      if (note) note.textContent = 'The outreach list could not be loaded.';
      return;
    }
    const recent = book.recentOutreach(rows, 15);
    if (!recent.length) {
      if (note) note.textContent = 'No outreach entries yet. They will appear here after the next load.';
      return;
    }
    if (note) note.textContent = recent.length === 1 ? '1 most recent entry.' : `${recent.length} most recent entries.`;
    for (const row of recent) {
      const tr = document.createElement('tr');
      const addCell = (label, node) => {
        const td = document.createElement('td');
        td.dataset.label = label;
        if (typeof node === 'string') td.textContent = node;
        else td.append(node);
        tr.append(td);
      };
      addCell('Found', book.formatDateOnly(row.date_found) || 'Date not set');
      const place = document.createElement('span');
      const href = book.safeHttpUrl(row.url);
      if (href) {
        const link = el('a', 'book-place', row.place || 'Open');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        place.append(link);
      } else {
        place.textContent = row.place || '';
      }
      addCell('Place', place);
      addCell('Language', row.language || '');
      const stage = document.createElement('span');
      stage.append(el('strong', 'stage-name', book.stageLabel(row.stage)));
      if (row.raw_status) stage.append(el('span', 'stage-raw', row.raw_status));
      addCell('Stage', stage);
      addCell('Posted', book.formatDateOnly(row.posted_date));
      const notes = el('span', 'book-note', row.notes || '');
      addCell('Notes', notes);
      body.append(tr);
    }
  }

  function paint(bundle) {
    const now = new Date();
    const today = $('book-today');
    if (today && calendar) {
      today.textContent = new Intl.DateTimeFormat('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: calendar.troyZone(now)
      }).format(now).toUpperCase();
    }
    paintAppearances(bundle.events.rows, bundle.events.state);
    paintStages(bundle.outreach.state === 'ok' ? bundle.outreach.rows : []);
    paintTable(bundle.outreach.rows, bundle.outreach.state);
  }

  function wire() {
    if (wired) return;
    wired = true;
    const link = $('book-notes-link');
    if (link) {
      link.href = NOTES_URL;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    $('book-refresh')?.addEventListener('click', () => {
      const button = $('book-refresh');
      button.disabled = true;
      load({ client }).finally(() => { button.disabled = false; });
    });
  }

  async function readRows(api, name, columns) {
    const { data, error } = await api.from(name).select(columns).limit(1000);
    if (error) return { rows: [], state: book.isMissingRelation(error) ? 'missing' : 'error', error };
    return { rows: data || [], state: 'ok', error: null };
  }

  async function load(context) {
    const current = ++token;
    client = context?.client || client;
    if (!book || !calendar) throw new Error('Elite Mindset Book helpers did not load.');
    wire();
    setStatus('Loading the book.');
    showError('');
    if (!client) {
      setStatus('');
      showError('The book is not connected yet. The rest of your dashboard is unaffected.');
      return;
    }
    const api = client.schema('family_api');
    let events;
    let outreachRows;
    try {
      [events, outreachRows] = await Promise.all([
        readRows(api, 'calendar_events', 'id,title,starts_at,ends_at,tz,all_day,category,source,location,link,notes,status'),
        readRows(api, 'book_outreach', 'id,date_found,place,url,language,stage,raw_status,posted_date,notes,updated_at')
      ]);
    } catch (error) {
      if (current !== token) return;
      console.error('Elite Mindset Book request failed.', error);
      setStatus('');
      showError('The book could not be loaded. The rest of your dashboard is unaffected.');
      return;
    }
    if (current !== token) return;
    appearances = events.rows;
    outreach = outreachRows.rows;
    if (events.state === 'error' && outreachRows.state === 'error') {
      showError('The book could not be loaded. The rest of your dashboard is unaffected.');
    } else if (events.state === 'missing' && outreachRows.state === 'missing') {
      showError('Book storage is not ready yet. The rest of your dashboard is unaffected.');
    } else {
      showError('');
    }
    setStatus('');
    paint({ events, outreach: outreachRows });
  }

  function clear() {
    token += 1;
    client = null;
    appearances = [];
    outreach = [];
    showError('');
    setStatus('');
    const today = $('book-today');
    const note = $('book-table-note');
    if (today) today.textContent = '';
    if (note) note.textContent = '';
    $('book-appearances')?.replaceChildren();
    $('book-stages')?.replaceChildren();
    $('book-rows')?.replaceChildren();
  }

  window.FamilyOSBook = { load, clear };
})();
