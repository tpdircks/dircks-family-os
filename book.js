/* Books tab. Loaded only when that tab is first opened.
 * Elite Mindset keeps booked appearances and outreach.
 * Signal Over Noise is the pre-launch countdown, milestones, and the same outreach list.
 * Renders into #panel-book and never touches the finance panel. */
(() => {
  'use strict';

  const book = window.FamilyOSBookModel;
  const calendar = window.FamilyOSCalendarModel;
  const $ = (id) => document.getElementById(id);

  const OUTREACH_COLUMNS = 'id,date_found,place,url,language,stage,raw_status,posted_date,notes,updated_at';
  let token = 0;
  let client = null;
  let wired = false;
  let selectedBook = book ? book.DEFAULT_BOOK_ID : 'elite_mindset';
  let cache = emptyCache();

  function emptyCache() {
    return {
      events: { rows: [], state: 'ok' },
      outreach: { rows: [], state: 'ok', bookColumn: true }
    };
  }

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

  function setHidden(id, hidden) {
    const node = $(id);
    if (!node) return;
    node.hidden = hidden;
    node.classList.toggle('is-hidden', hidden);
  }

  function paintSwitcher() {
    const host = $('book-switch');
    if (!host || !book) return;
    const existing = [...host.querySelectorAll('[data-book]')];
    const same = existing.length === book.BOOKS.length
      && existing.every((node, index) => node.dataset.book === book.BOOKS[index].id);
    if (!same) {
      host.replaceChildren();
      for (const entry of book.BOOKS) {
        const button = el('button', '', entry.label);
        button.type = 'button';
        button.dataset.book = entry.id;
        host.append(button);
      }
    }
    for (const button of host.querySelectorAll('[data-book]')) {
      const on = button.dataset.book === selectedBook;
      button.classList.toggle('selected', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function paintChrome(view) {
    const title = $('book-title');
    const lead = $('book-lead');
    if (title) title.textContent = view.heading;
    if (lead) lead.textContent = view.lead;
    const notes = $('book-notes-link');
    if (notes && view.showNotes && view.notesUrl) {
      notes.href = view.notesUrl;
      notes.target = '_blank';
      notes.rel = 'noopener noreferrer';
    }
    setHidden('book-notes-link', !view.showNotes);
    setHidden('book-prelaunch', !view.prelaunch);
    setHidden('book-appearances-card', !view.showAppearances);
    const heading = $('book-outreach-heading');
    if (heading) heading.textContent = view.outreachHeading;
    paintSwitcher();
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

  function paintTable(rows, state, view, bookColumn) {
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
    if (view.prelaunch && !bookColumn) {
      if (note) note.textContent = 'Presale and marketing outreach will show here after the book column is added.';
      return;
    }
    const recent = book.recentOutreach(book.rowsForBook(rows, view.id), 15);
    if (!recent.length) {
      if (note) {
        note.textContent = view.prelaunch
          ? 'No presale or marketing entries yet. They will appear here after the next load.'
          : 'No outreach entries yet. They will appear here after the next load.';
      }
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

  function paintCountdown(view, now, zone) {
    const number = $('book-countdown');
    const note = $('book-countdown-note');
    const when = $('book-launch-date');
    const countdown = book.launchCountdown(view.id, now, zone);
    if (!countdown) {
      if (number) {
        number.textContent = '';
        number.removeAttribute('aria-label');
      }
      if (note) note.textContent = 'Launch date is not available.';
      if (when) when.textContent = '';
      return;
    }
    if (when) when.textContent = countdown.launchLabel;
    if (number) {
      number.textContent = countdown.number;
      number.setAttribute('aria-label', countdown.spoken);
    }
    if (note) note.textContent = countdown.note;
  }

  function paintMilestones(view, now, zone) {
    const host = $('book-milestones');
    if (!host) return;
    host.replaceChildren();
    const items = book.milestonePlan(view.id, now, zone);
    if (!items.length) {
      empty(host, 'Milestones will show here when they are added.');
      return;
    }
    for (const item of items) {
      const row = el('article', `milestone is-${item.tone}`);
      const date = el('div', 'milestone-date');
      date.append(el('span', '', item.month), el('strong', '', item.day));
      const copy = el('div', 'milestone-copy');
      copy.append(el('h3', '', item.label), el('p', '', item.dateLabel));
      const pillClass = item.tone === 'today' ? 'pill accent' : 'pill';
      row.append(date, copy, el('span', pillClass, item.status));
      host.append(row);
    }
  }

  function clearPrelaunch() {
    const number = $('book-countdown');
    const note = $('book-countdown-note');
    const when = $('book-launch-date');
    if (number) {
      number.textContent = '';
      number.removeAttribute('aria-label');
    }
    if (note) note.textContent = '';
    if (when) when.textContent = '';
    $('book-milestones')?.replaceChildren();
  }

  function paint(bundle) {
    const view = book.viewFor(selectedBook);
    const now = new Date();
    const zone = calendar.troyZone(now);
    const today = $('book-today');
    if (today) {
      today.textContent = new Intl.DateTimeFormat('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: zone
      }).format(now).toUpperCase();
    }
    paintChrome(view);
    if (view.showAppearances) paintAppearances(bundle.events.rows, bundle.events.state);
    else $('book-appearances')?.replaceChildren();
    if (view.prelaunch) {
      paintCountdown(view, now, zone);
      paintMilestones(view, now, zone);
    } else {
      clearPrelaunch();
    }
    const outreachRows = bundle.outreach.state === 'ok' ? book.rowsForBook(bundle.outreach.rows, view.id) : [];
    paintStages(outreachRows);
    paintTable(bundle.outreach.rows, bundle.outreach.state, view, bundle.outreach.bookColumn);
    if (view.prelaunch && bundle.outreach.state === 'ok' && !bundle.outreach.bookColumn) {
      setStatus('Presale outreach stays empty until the book column exists. Elite Mindset is unchanged.');
    } else {
      setStatus('');
    }
  }

  function wire() {
    if (wired) return;
    wired = true;
    paintSwitcher();
    $('book-switch')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-book]');
      if (!button || !book.bookById(button.dataset.book)) return;
      if (button.dataset.book === selectedBook) return;
      selectedBook = button.dataset.book;
      paint(cache);
    });
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

  async function readOutreach(api) {
    const withBook = await readRows(api, 'book_outreach', `${OUTREACH_COLUMNS},book`);
    if (withBook.state !== 'error' || !book.isMissingColumn(withBook.error, 'book')) {
      return {
        rows: withBook.rows,
        state: withBook.state,
        error: withBook.error,
        bookColumn: withBook.state === 'ok'
      };
    }
    const plain = await readRows(api, 'book_outreach', OUTREACH_COLUMNS);
    return { rows: plain.rows, state: plain.state, error: plain.error, bookColumn: false };
  }

  async function load(context) {
    const current = ++token;
    client = context?.client || client;
    if (!book || !calendar) throw new Error('Books helpers did not load.');
    wire();
    setStatus('Loading books.');
    showError('');
    if (!client) {
      setStatus('');
      showError('Books are not connected yet. The rest of your dashboard is unaffected.');
      return;
    }
    const api = client.schema('family_api');
    let events;
    let outreachRows;
    try {
      [events, outreachRows] = await Promise.all([
        readRows(api, 'calendar_events', 'id,title,starts_at,ends_at,tz,all_day,category,source,location,link,notes,status'),
        readOutreach(api)
      ]);
    } catch (error) {
      if (current !== token) return;
      console.error('Books request failed.', error);
      setStatus('');
      showError('Books could not be loaded. The rest of your dashboard is unaffected.');
      return;
    }
    if (current !== token) return;
    if (events.state === 'error' && outreachRows.state === 'error') {
      showError('Books could not be loaded. The rest of your dashboard is unaffected.');
    } else if (events.state === 'missing' && outreachRows.state === 'missing') {
      showError('Book storage is not ready yet. The rest of your dashboard is unaffected.');
    } else {
      showError('');
    }
    setStatus('');
    cache = { events, outreach: outreachRows };
    paint(cache);
  }

  function clear() {
    token += 1;
    client = null;
    selectedBook = book ? book.DEFAULT_BOOK_ID : 'elite_mindset';
    cache = emptyCache();
    showError('');
    setStatus('');
    const today = $('book-today');
    const note = $('book-table-note');
    if (today) today.textContent = '';
    if (note) note.textContent = '';
    $('book-appearances')?.replaceChildren();
    $('book-stages')?.replaceChildren();
    $('book-rows')?.replaceChildren();
    clearPrelaunch();
    if (book) paintChrome(book.viewFor(selectedBook));
  }

  window.FamilyOSBook = { load, clear };
})();
