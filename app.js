/* Dircks Family OS. Financial content is fetched only after an approved session.
 * Every personal table also has RLS policies in the SQL migration. */
(() => {
  'use strict';

  const config = window.FAMILY_OS_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const money = (value, digits = 2) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits
  }).format(Number(value || 0));
  const text = (value) => String(value == null ? '' : value);
  const el = (tag, className, content) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = text(content);
    return node;
  };
  const dateOnly = (value) => {
    if (!value) return '';
    return text(value).slice(0, 10);
  };
  const friendlyDate = (value, withYear = false) => {
    if (!value) return 'Date not set';
    const parsed = new Date(`${dateOnly(value)}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return 'Date not set';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {})
    }).format(parsed);
  };
  const todayInDenver = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
  const escapeXml = (value) => text(value).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

  let client;
  let activeUser = null;
  let idleTimer;
  let warningTimer;
  let recoverySession = false;
  let lastInteraction = Date.now();
  let cachedData = { accounts: [], snapshots: [], income: [], bills: [], mortgageTerms: [] };
  let currentFilter = 'asset';

  /* Life OS tabs. Add one entry, one [data-tab-panel] section, and an optional
   * load/clear hook. See README.md. localStorage stores the tab id only. */
  const ASSET_VERSION = '20261123a';
  const TAB_STORAGE_KEY = 'family-os-tab';
  const TABS = [
    { id: 'finances', label: 'Finances', load: loadFinances, clear: clearFinances },
    { id: 'calendar', label: 'Calendar', load: loadCalendarTab, clear: clearCalendarTab },
    { id: 'book', label: 'Books', load: loadBookTab, clear: clearBookTab },
    { id: 'physical', label: 'Physical Progress', load: loadPhysicalTab, clear: clearPhysicalTab }
  ];
  const tabRuntime = new Map();
  let sessionEpoch = 0;
  let userChoseTab = false;
  let appliedSavedTab = false;
  let didPrefetchTab = false;

  function setStatus(id, message, success = false) {
    const node = $(id);
    node.textContent = message;
    node.classList.toggle('success', success);
  }

  function showError(message) {
    const node = $('data-error');
    if (!message) {
      node.classList.add('is-hidden');
      node.textContent = '';
      return;
    }
    node.textContent = message;
    node.classList.remove('is-hidden');
  }

  function savedTabId() {
    try {
      const value = localStorage.getItem(TAB_STORAGE_KEY);
      return TABS.some((tab) => tab.id === value) ? value : TABS[0].id;
    } catch (error) {
      return TABS[0].id;
    }
  }

  function markTabLoaded(id, loaded) {
    const state = tabRuntime.get(id) || {};
    state.loaded = loaded;
    tabRuntime.set(id, state);
  }

  function mountTabs() {
    const list = document.querySelector('[data-tablist]');
    if (!list || list.dataset.ready === '1') return;
    list.dataset.ready = '1';
    for (const tab of TABS) {
      const button = el('button', 'tab', tab.label);
      button.type = 'button';
      button.id = `tab-${tab.id}`;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', `panel-${tab.id}`);
      button.dataset.tab = tab.id;
      button.tabIndex = -1;
      button.setAttribute('aria-selected', 'false');
      list.append(button);
    }
    list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      activateTab(button.dataset.tab, { user: true });
    });
    list.addEventListener('keydown', onTabKeydown);
    selectTab(TABS[0].id);
  }

  function onTabKeydown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-tablist] [role="tab"]')];
    if (!tabs.length) return;
    const focused = tabs.indexOf(document.activeElement);
    const selected = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const current = focused >= 0 ? focused : Math.max(0, selected);
    let next = current;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    event.preventDefault();
    activateTab(tabs[next].dataset.tab, { user: true, focus: true });
  }

  function selectTab(id, { focus = false } = {}) {
    const chosen = TABS.some((tab) => tab.id === id) ? id : TABS[0].id;
    for (const tab of TABS) {
      const button = document.getElementById(`tab-${tab.id}`);
      const panel = document.querySelector(`[data-tab-panel="${tab.id}"]`);
      const selected = tab.id === chosen;
      if (button) {
        button.setAttribute('aria-selected', selected ? 'true' : 'false');
        button.tabIndex = selected ? 0 : -1;
        if (selected && focus) button.focus();
      }
      if (panel) {
        panel.hidden = !selected;
        panel.classList.toggle('is-hidden', !selected);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', `tab-${tab.id}`);
      }
    }
  }

  function showTabFailure(tab) {
    const panel = document.querySelector(`[data-tab-panel="${tab.id}"]`);
    if (!panel) return;
    let banner = panel.querySelector('[data-tab-error]');
    if (!banner) {
      banner = el('p', 'error-banner');
      banner.setAttribute('data-tab-error', '');
      banner.setAttribute('role', 'alert');
      panel.prepend(banner);
    }
    banner.classList.remove('is-hidden');
    banner.textContent = 'This section could not be opened. The rest of your dashboard is still available.';
  }

  function clearTabFailure(tab) {
    document.querySelector(`[data-tab-panel="${tab.id}"]`)?.querySelector('[data-tab-error]')?.remove();
  }

  async function activateTab(id, { user = false, focus = false, force = false } = {}) {
    const tab = TABS.find((item) => item.id === id) || TABS[0];
    if (user) {
      userChoseTab = true;
      try { localStorage.setItem(TAB_STORAGE_KEY, tab.id); } catch (error) { /* storage unavailable */ }
    }
    selectTab(tab.id, { focus });
    if (typeof tab.load !== 'function') return;
    const state = tabRuntime.get(tab.id) || { loaded: false, inflight: null };
    tabRuntime.set(tab.id, state);
    if (state.loaded && !force) return;
    if (state.inflight && !force) return state.inflight;
    const epoch = sessionEpoch;
    state.inflight = (async () => {
      try {
        clearTabFailure(tab);
        await tab.load();
        if (epoch !== sessionEpoch) return;
        state.loaded = true;
      } catch (error) {
        if (epoch !== sessionEpoch) return;
        state.loaded = false;
        console.error(`Tab "${tab.id}" failed.`, error);
        showTabFailure(tab);
      } finally {
        state.inflight = null;
      }
    })();
    return state.inflight;
  }

  function prefetchSavedTab() {
    if (didPrefetchTab) return;
    didPrefetchTab = true;
    const saved = savedTabId();
    if (saved === 'finances') return;
    activateTab(saved);
  }

  function revealApp({ armIdle = false } = {}) {
    if (!appliedSavedTab && !userChoseTab) {
      appliedSavedTab = true;
      selectTab(savedTabId());
    }
    $('login-screen').classList.add('is-hidden');
    $('app-shell').classList.remove('is-hidden');
    if (armIdle) armIdleTimeout();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-family-src="${CSS.escape(src)}"]`);
      if (existing?.dataset.loaded === '1') { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.dataset.familySrc = src;
      script.onload = () => { script.dataset.loaded = '1'; resolve(); };
      script.onerror = () => {
        script.remove();
        reject(new Error('The section script could not be loaded.'));
      };
      document.head.appendChild(script);
    });
  }

  function clearFinances() {
    // Clear both DOM and in-memory private data on logout. Never cache balances.
    cachedData = { accounts: [], snapshots: [], income: [], bills: [], mortgageTerms: [] };
    $('accounts-list').replaceChildren();
    $('upcoming-bills').replaceChildren();
    $('bills-table-body').replaceChildren();
    $('income-list').replaceChildren();
    $('property-equity').replaceChildren();
    $('mortgage-details').replaceChildren();
    $('history-chart').replaceChildren();
    $('bill-notes').replaceChildren();
    $('all-bills').classList.remove('is-hidden');
    $('net-worth').textContent = '$0.00';
    $('hero-assets').textContent = '$0.00';
    $('hero-liabilities').textContent = '$0.00';
    $('murray-equity').textContent = '$0.00';
    $('acura-equity').textContent = '$0.00';
    $('as-of-summary').textContent = 'Assets minus liabilities';
    $('history-caption').textContent = '';
    $('planned-bills-total').textContent = '$0.00';
    $('attention-banner').classList.add('is-hidden');
  }

  function clearPhysicalTab() {
    if (!window.FamilyOSPhysical) return;
    try { window.FamilyOSPhysical.clear(); } catch (error) {
      console.error('Could not clear physical progress.', error);
    }
  }

  async function loadFinances() {
    await loadDashboard();
  }

  async function loadPhysicalTab() {
    await loadScript(`health-model.js?v=${ASSET_VERSION}`);
    await loadScript(`physical.js?v=${ASSET_VERSION}`);
    if (!window.FamilyOSPhysical || !window.FamilyOSHealthModel) throw new Error('Physical progress did not initialize.');
    await window.FamilyOSPhysical.load({ client });
  }

  function clearCalendarTab() {
    if (!window.FamilyOSCalendar) return;
    try { window.FamilyOSCalendar.clear(); } catch (error) {
      console.error('Could not clear the calendar.', error);
    }
  }

  function clearBookTab() {
    if (!window.FamilyOSBook) return;
    try { window.FamilyOSBook.clear(); } catch (error) {
      console.error('Could not clear the book.', error);
    }
  }

  async function loadCalendarTab() {
    await loadScript(`calendar-model.js?v=${ASSET_VERSION}`);
    await loadScript(`calendar.js?v=${ASSET_VERSION}`);
    if (!window.FamilyOSCalendar || !window.FamilyOSCalendarModel) throw new Error('Calendar did not initialize.');
    await window.FamilyOSCalendar.load({ client });
  }

  async function loadBookTab() {
    await loadScript(`calendar-model.js?v=${ASSET_VERSION}`);
    await loadScript(`book-model.js?v=${ASSET_VERSION}`);
    await loadScript(`book.js?v=${ASSET_VERSION}`);
    if (!window.FamilyOSBook || !window.FamilyOSBookModel || !window.FamilyOSCalendarModel) {
      throw new Error('Books did not initialize.');
    }
    await window.FamilyOSBook.load({ client });
  }

  function resetDataView() {
    sessionEpoch += 1;
    userChoseTab = false;
    appliedSavedTab = false;
    didPrefetchTab = false;
    for (const state of tabRuntime.values()) {
      state.loaded = false;
      state.inflight = null;
    }
    for (const tab of TABS) {
      if (typeof tab.clear !== 'function') continue;
      try { tab.clear(); } catch (error) {
        console.error(`Could not clear the ${tab.id} tab.`, error);
      }
    }
    $('app-shell').classList.add('is-hidden');
    $('login-screen').classList.remove('is-hidden');
    $('set-password-view').classList.add('is-hidden');
    $('login-form-view').classList.remove('is-hidden');
    $('password').value = '';
    $('new-password').value = '';
    $('confirm-password').value = '';
    activeUser = null;
    recoverySession = false;
  }

  function clearTimers() {
    if (idleTimer) clearTimeout(idleTimer);
    if (warningTimer) clearTimeout(warningTimer);
    idleTimer = undefined;
    warningTimer = undefined;
  }

  async function secureSignOut(reason = '') {
    clearTimers();
    resetDataView();
    if (client) {
      try { await client.auth.signOut({ scope: 'global' }); } catch (error) {
        console.warn('Sign-out request did not complete.', error);
      }
    }
    if (reason) setStatus('login-status', reason);
  }

  function armIdleTimeout() {
    clearTimers();
    if (!config.idleTimeoutMinutes || config.idleTimeoutMinutes < 1) return;
    lastInteraction = Date.now();
    const timeout = config.idleTimeoutMinutes * 60 * 1000;
    const deadline = Date.now() + timeout;
    idleTimer = setTimeout(() => secureSignOut(`Your session closed after ${config.idleTimeoutMinutes} minutes without activity. Please sign in again.`), Math.max(0, deadline - Date.now()));
  }

  async function approvedSession() {
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
    if (!session) return null;
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user || !user.email || user.email.toLowerCase() !== config.allowedEmail.toLowerCase()) {
      await secureSignOut(user ? 'This account is not approved for the family dashboard.' : '');
      return null;
    }
    return { user, session };
  }

  function accountKey(name) {
    return text(name).toLowerCase();
  }

  function latestAsOf(accounts) {
    const values = accounts.filter((a) => a.as_of).map((a) => a.as_of).sort();
    return values.length ? values[values.length - 1] : null;
  }

  function renderHero(accounts) {
    const assets = accounts.filter((a) => a.class === 'asset');
    const liabilities = accounts.filter((a) => a.class === 'liability');
    const totalAssets = assets.reduce((sum, a) => sum + Number(a.current_balance || 0), 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + Number(a.current_balance || 0), 0);
    const netWorth = totalAssets - totalLiabilities;
    $('net-worth').textContent = money(netWorth);
    $('hero-assets').textContent = money(totalAssets);
    $('hero-liabilities').textContent = money(totalLiabilities);
    const total = totalAssets + totalLiabilities;
    const assetPct = total ? (totalAssets / total) * 100 : 0;
    const liabilityPct = total ? 100 - assetPct : 0;
    $('asset-share').style.width = `${assetPct}%`;
    $('liability-share').style.width = `${liabilityPct}%`;
    $('asset-percent').textContent = `${assetPct.toFixed(1)}%`;
    $('liability-percent').textContent = `${liabilityPct.toFixed(1)}%`;
    $('asset-count').textContent = assets.length;
    $('liability-count').textContent = liabilities.length;
    const asOf = latestAsOf(accounts);
    $('as-of-summary').textContent = asOf ? `Based on your latest balances. Data as of ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver', timeZoneName: 'short' }).format(new Date(asOf))}.` : 'Assets minus liabilities';
    const lookup = (words) => accounts.find((a) => words.every((word) => accountKey(a.name).includes(word)));
    const murray = lookup(['murray']);
    const mortgage = lookup(['mortgage']);
    const acura = assets.find((a) => accountKey(a.name).includes('acura'));
    const auto = accounts.find((a) => a.class === 'liability' && accountKey(a.name).includes('auto'));
    if (murray && mortgage) $('murray-equity').textContent = money(murray.current_balance - mortgage.current_balance);
    if (acura && auto) $('acura-equity').textContent = money(acura.current_balance - auto.current_balance);
    return { assets, liabilities, totalAssets, totalLiabilities, netWorth };
  }

  function institutionTotal(accounts) {
    return accounts.reduce((sum, a) => sum + Number(a.current_balance || 0), 0);
  }

  function renderAccounts(accounts) {
    $('accounts-list').replaceChildren();
    const isClosed = (a) => a.source === 'manual' && Number(a.current_balance) === 0 && /paid off|traded in|closed/i.test(a.source_detail || '');
    const filtered = accounts.filter((a) => a.class === currentFilter && !isClosed(a)).sort((a, b) => a.institution.localeCompare(b.institution) || Number(b.current_balance) - Number(a.current_balance));
    const institutions = [...new Set(filtered.map((a) => a.institution))];
    for (const institution of institutions) {
      const rows = filtered.filter((a) => a.institution === institution);
      const block = el('section', 'institution-block');
      const heading = el('div', 'institution-heading');
      heading.append(el('h3', '', institution), el('strong', '', money(institutionTotal(rows))));
      block.append(heading);
      for (const account of rows) {
        const row = el('div', `account-row ${account.class}`);
        const icon = account.category === 'investment' ? '↗' : account.class === 'asset' ? '$' : account.category === 'mortgage' ? '⌂' : '•';
        const main = el('div', 'account-main');
        const title = el('div', 'account-title', account.name);
        const badge = el('span', `badge ${account.source === 'manual' ? 'manual' : ''}`, account.source === 'manual' ? 'Manual' : 'Linked');
        title.append(badge);
        const meta = el('div', 'account-meta', `${account.mask ? `Ending ${account.mask}` : 'No account number'} · ${account.source_detail || ''}`);
        main.append(title, meta);
        row.append(el('div', 'account-icon', icon), main, el('div', 'account-amount', money(account.current_balance)));
        block.append(row);
      }
      $('accounts-list').append(block);
    }
  }

  function renderPropertyEquity(accounts) {
    $('property-equity').replaceChildren();
    const lookup = (words, cls = '') => accounts.find((a) => (!cls || a.class === cls) && words.every((word) => accountKey(a.name).includes(word)));
    const murrayValue = Number(lookup(['murray'], 'asset')?.current_balance || 0);
    const mortgageBalance = Number(lookup(['mortgage'], 'liability')?.current_balance || 0);
    const acuraValue = Number(lookup(['acura'], 'asset')?.current_balance || 0);
    const autoBalance = Number(lookup(['auto'], 'liability')?.current_balance || 0);
    const properties = [
      { name: 'Murray home', detail: 'Assessed reference value', value: murrayValue, debt: mortgageBalance },
      { name: 'Brazil home', detail: 'Owner value. Owned outright', value: Number(lookup(['brazil'], 'asset')?.current_balance || 0), debt: 0 },
      { name: 'Acura MDX', detail: 'Owner estimate', value: acuraValue, debt: autoBalance },
      { name: 'Lincoln MKZ', detail: 'Generic value reference. Owned outright', value: Number(lookup(['lincoln'], 'asset')?.current_balance || 0), debt: 0 }
    ];
    for (const property of properties) {
      const equity = property.value - property.debt;
      const item = el('div', 'equity-item');
      const top = el('div', 'equity-top');
      top.append(el('h3', '', property.name), el('strong', '', money(equity)));
      const bar = el('div', 'equity-bar');
      const fill = el('div');
      fill.style.width = `${property.value ? Math.max(0, Math.min(100, (equity / property.value) * 100)) : 0}%`;
      bar.append(fill);
      const bottom = el('div', 'equity-bottom');
      bottom.append(el('span', '', `${property.detail}: ${money(property.value)}`), el('span', '', property.debt ? `Loan: ${money(property.debt)}` : 'No loan'));
      item.append(top, bar, bottom);
      $('property-equity').append(item);
    }
  }

  function renderIncome(rows) {
    $('income-list').replaceChildren();
    for (const row of rows) {
      const item = el('div', 'income-row');
      const main = el('div');
      main.append(el('h3', '', row.name), el('p', '', row.detail));
      const value = el('div', 'income-value');
      value.append(el('strong', '', money(row.amount, row.amount % 1 ? 2 : 0)), el('span', '', row.frequency));
      item.append(main, value);
      $('income-list').append(item);
    }
    if (!rows.length) $('income-list').append(el('p', 'small muted', 'Income will appear after the first data sync.'));
  }

  function billRow(bill) {
    const row = el('div', 'bill-row');
    const badge = el('div', 'bill-date');
    const date = dateOnly(bill.due_date);
    badge.append(el('span', '', date ? friendlyDate(date).split(' ')[0] : 'Date'), el('strong', '', date ? new Date(`${date}T12:00:00`).getDate() : '?'));
    const main = el('div', 'bill-info');
    main.append(el('h3', '', bill.name), el('p', '', bill.detail || bill.category || ''));
    row.append(badge, main, el('div', 'bill-amount', money(bill.amount)));
    return row;
  }

  function renderBills(rows, latestAsOf) {
    const planned = rows.filter((r) => r.due_date === '2026-11-13' && r.status !== 'pending' && r.status !== 'paid');
    const upcoming = rows.filter((r) => r.status !== 'paid').sort((a, b) => dateOnly(a.due_date).localeCompare(dateOnly(b.due_date)));
    $('upcoming-bills').replaceChildren(...planned.map(billRow));
    $('planned-bills-total').textContent = money(planned.reduce((sum, r) => sum + Number(r.amount), 0));
    $('bills-table-body').replaceChildren();
    for (const bill of upcoming) {
      const tr = document.createElement('tr');
      tr.append(el('td', '', bill.name), el('td', '', friendlyDate(bill.due_date, true)), el('td', 'status-text', bill.status === 'pending' ? `${bill.status_label || 'Payment pending'}. Not yet posted.` : bill.status_label || bill.status), el('td', 'right', money(bill.amount)));
      $('bills-table-body').append(tr);
    }
    $('bill-notes').replaceChildren();
    for (const row of rows.filter((r) => r.status === 'pending')) $('bill-notes').append(el('div', 'note', `${row.name}: ${row.notes}`));
  }

  function renderMortgageDetails(rows) {
    $('mortgage-details').replaceChildren();
    if (!rows.length) return;
    const terms = rows[0];
    const values = [
      [`Principal and interest`, money(terms.principal_and_interest)],
      [`Next total payment`, `${money(terms.next_payment_amount)} due ${friendlyDate(terms.next_payment_date, true)}`],
      [`Original loan`, `${money(terms.original_principal, 0)} · ${terms.term_years} years fixed`]
    ];
    for (const [label, value] of values) {
      const stat = el('div', 'mortgage-stat');
      stat.append(el('span', '', label), el('strong', '', value));
      $('mortgage-details').append(stat);
    }
  }

  function renderHistory(snapshots) {
    const days = [...new Set(snapshots.map((s) => s.snapshot_date))].sort();
    const totals = days.map((day) => {
      const rows = snapshots.filter((s) => s.snapshot_date === day);
      return { day, value: rows.reduce((sum, s) => sum + Number(s.signed_balance), 0), estimate: rows.some((s) => s.is_estimate) };
    });
    const $chart = $('history-chart');
    $chart.replaceChildren();
    if (totals.length < 2) {
      const empty = el('div', 'empty-history');
      empty.append(el('div', 'empty-icon', '↗'), el('h3', '', totals.length ? 'Your first snapshot is saved.' : 'Your history starts today.'), el('p', '', 'Daily account syncs build your net worth chart here. Come back tomorrow to see your first trend line.'));
      $chart.append(empty);
      $('history-caption').textContent = totals.length ? 'One daily snapshot so far. ' : 'No account snapshots yet. ';
      if (totals.length) $('history-caption').textContent += `Today: ${money(totals[0].value)}.`;
      return;
    }
    const width = 700, height = 250, left = 65, right = 25, top = 22, bottom = 40;
    const t = (day) => new Date(`${day}T12:00:00`).getTime();
    const t0 = t(totals[0].day), t1 = t(totals[totals.length - 1].day);
    const values = totals.map((r) => r.value);
    let min = Math.min(...values), max = Math.max(...values);
    const padding = Math.max((max - min) * .08, 100);
    min -= padding; max += padding;
    const x = (day) => left + ((t(day) - t0) / Math.max(t1 - t0, 1)) * (width - left - right);
    const y = (value) => top + ((max - value) / (max - min || 1)) * (height - top - bottom);
    const pts = (rows) => rows.map((r) => `${x(r.day).toFixed(1)},${y(r.value).toFixed(1)}`).join(' ');
    const lastEst = totals.reduce((i, r, idx) => (r.estimate ? idx : i), -1);
    const estRows = lastEst >= 0 ? totals.slice(0, lastEst + 2) : [];
    const actualRows = lastEst >= 0 ? totals.slice(lastEst + 1) : totals;
    const areaPoints = `${left},${height - bottom} ${pts(totals)} ${width - right},${height - bottom}`;
    let grid = '';
    for (let i = 0; i <= 3; i++) {
      const v = min + ((max - min) * i / 3);
      const yy = y(v);
      grid += `<line x1="${left}" x2="${width - right}" y1="${yy}" y2="${yy}" stroke="#e4eae1" stroke-width="1" /><text x="${left - 10}" y="${yy + 4}" text-anchor="end">${escapeXml(money(v, 0))}</text>`;
    }
    const years = [];
    for (let yr = new Date(t0).getFullYear() + 1; yr <= new Date(t1).getFullYear(); yr++) years.push(yr);
    const yearLabel = (xx, yr) => `<text class="chart-year" x="${xx.toFixed(1)}" y="${height - 24}" text-anchor="start">${yr}</text>`;
    const ticks = yearLabel(left, new Date(t0).getFullYear()) + years.map((yr) => { const xx = x(`${yr}-01-01`); return `<line x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${top}" y2="${height - bottom}" stroke="#e4eae1" stroke-width="1" />${yearLabel(xx + 3, yr)}`; }).join('');
    const first = totals[0], last = totals[totals.length - 1];
    const estLine = estRows.length > 1 ? `<polyline class="chart-line" style="stroke-dasharray:6 5;opacity:.75" points="${pts(estRows)}"/>` : '';
    const actLine = actualRows.length > 1 ? `<polyline class="chart-line" points="${pts(actualRows)}"/>` : '';
    $chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Net worth history from ${escapeXml(first.day)} to ${escapeXml(last.day)}"><defs><linearGradient id="history-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5d9e77" stop-opacity=".27"/><stop offset="100%" stop-color="#5d9e77" stop-opacity="0"/></linearGradient></defs>${grid}${ticks}<polygon class="chart-area" points="${areaPoints}"/>${estLine}${actLine}<circle class="chart-point" cx="${x(last.day)}" cy="${y(last.value)}" r="5"/><text x="${left}" y="${height - 8}">${escapeXml(friendlyDate(first.day))}</text><text x="${width - right}" y="${height - 8}" text-anchor="end">${escapeXml(friendlyDate(last.day))}</text></svg>`;
    const change = last.value - first.value;
    let caption = `Net worth ${change >= 0 ? 'grew' : 'fell'} ${money(Math.abs(change))} from ${money(first.value)} on ${friendlyDate(first.day, true)} to ${money(last.value)} on ${friendlyDate(last.day, true)}.`;
    if (lastEst >= 0) caption += ` Dashed line = estimated history (home value from a local price index; the 2019 to 2021 loan balance is modeled). Before Nov 2025 it counts home equity (plus one vehicle and its loan from May 2025); Nov 2025 to Oct 2026 adds bank, card and vehicle balances; all accounts from Nov 6, 2026.`;
    $('history-caption').textContent = caption;
  }

  function renderAttention(accounts, bills) {
    const notes = [];
    const pending = bills.filter((r) => r.status === 'pending' && r.notes);
    for (const bill of pending) notes.push(`${bill.name}: ${bill.notes}`);
    const chase = accounts.find((a) => accountKey(a.name).includes('prime'));
    const plannedChase = bills.find((r) => r.name.toLowerCase().includes('chase') && r.due_date === '2026-11-13');
    if (chase && plannedChase && Number(chase.current_balance) < Number(plannedChase.amount)) notes.push(`Before your November 13 Chase payment, confirm the live payoff amount. Your linked balance is ${money(chase.current_balance)}, below the ${money(plannedChase.amount)} plan.`);
    if (!notes.length) return;
    $('attention-banner').classList.remove('is-hidden');
    const strong = el('strong', '', 'Worth a quick look. ');
    $('attention-banner').replaceChildren(strong, document.createTextNode(notes.join(' ')));
  }

  function render(data) {
    cachedData = data;
    const accounts = data.accounts;
    const totals = renderHero(accounts);
    renderAccounts(accounts);
    renderPropertyEquity(accounts);
    renderIncome(data.income);
    const asOf = latestAsOf(accounts);
    renderBills(data.bills, asOf);
    renderHistory(data.snapshots);
    renderMortgageDetails(data.mortgageTerms);
    renderAttention(accounts, data.bills);
    $('today-label').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' }).format(new Date()).toUpperCase();
    revealApp({ armIdle: true });
    return totals;
  }

  async function loadDashboard() {
    const epoch = sessionEpoch;
    const auth = await approvedSession();
    if (!auth || epoch !== sessionEpoch) return;
    activeUser = auth.user;
    const api = client.schema('family_api');
    try {
      const financeQueries = Promise.all([
        api.from('accounts').select('id,institution,name,mask,class,category,source,source_detail,current_balance,as_of').order('institution').order('name'),
        api.from('snapshots').select('snapshot_date,signed_balance,is_estimate').order('snapshot_date', { ascending: true }).limit(10000),
        api.from('income').select('id,name,amount,frequency,detail,starts_on,sort_order').order('sort_order'),
        api.from('bills').select('id,name,amount,due_date,status,status_label,category,detail,notes').order('due_date'),
        api.from('mortgage_terms').select('id,interest_rate,original_principal,term_years,principal_and_interest,next_payment_amount,next_payment_date,notes').limit(1)
      ]);
      prefetchSavedTab();
      const [accounts, snapshots, income, bills, mortgageTerms] = await financeQueries;
      if (epoch !== sessionEpoch) return;
      const queries = { accounts, snapshots, income, bills, mortgageTerms };
      const failed = Object.entries(queries).find(([, result]) => result.error);
      if (failed) throw new Error(`${failed[0]}: ${failed[1].error.message}`);
      showError('');
      render(Object.fromEntries(Object.entries(queries).map(([key, result]) => [key, result.data || []])));
      markTabLoaded('finances', true);
    } catch (error) {
      if (epoch !== sessionEpoch) return;
      markTabLoaded('finances', false);
      console.error('Dashboard data request failed:', error);
      showError('Your data could not be loaded right now. Please try again. If the problem continues, your Finance sync may need attention.');
      revealApp();
    }
  }

  async function signIn(event) {
    event.preventDefault();
    if (!client) return setStatus('login-status', 'The secure sign-in service is not available. Please check your connection and try again.');
    $('login-button').disabled = true;
    setStatus('login-status', 'Checking your account...', true);
    const { error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    $('login-button').disabled = false;
    if (error) {
      $('password').value = '';
      return setStatus('login-status', 'Your email or password did not work. Please try again, or email yourself a reset link.');
    }
    setStatus('login-status', '');
    await loadDashboard();
  }

  async function requestRecovery() {
    if (!client) return setStatus('login-status', 'The secure sign-in service is not available right now.');
    $('recovery-button').disabled = true;
    const { error } = await client.auth.resetPasswordForEmail(config.allowedEmail, { redirectTo: window.location.href.split('#')[0] });
    $('recovery-button').disabled = false;
    setStatus('login-status', error ? 'The reset email could not be sent right now. Please try again in a few minutes.' : 'If your account exists, Supabase has sent a password reset link to your Gmail. Open it on this device to choose a new password.', !error);
  }

  async function saveNewPassword(event) {
    event.preventDefault();
    const password = $('new-password').value;
    if (password.length < 12) return setStatus('password-status', 'Choose at least 12 characters.');
    if (password !== $('confirm-password').value) return setStatus('password-status', 'Those passwords do not match. Please try again.');
    $('set-password-button').disabled = true;
    const { error } = await client.auth.updateUser({ password });
    $('set-password-button').disabled = false;
    if (error) return setStatus('password-status', 'The password could not be saved. Please request a new reset link and try again.');
    recoverySession = false;
    $('new-password').value = '';
    $('confirm-password').value = '';
    $('set-password-view').classList.add('is-hidden');
    $('login-form-view').classList.remove('is-hidden');
    setStatus('login-status', 'Your password is saved. You are signed in.', true);
    await loadDashboard();
  }

  function cleanAuthHash() {
    if (window.location.hash && /access_token|refresh_token|type=/.test(window.location.hash)) {
      window.history.replaceState(null, '', window.location.href.split('#')[0]);
    }
  }

  function onAuthChange(event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      recoverySession = true;
      $('login-screen').classList.remove('is-hidden');
      $('app-shell').classList.add('is-hidden');
      $('login-form-view').classList.add('is-hidden');
      $('set-password-view').classList.remove('is-hidden');
      cleanAuthHash();
      return;
    }
    if (event === 'SIGNED_OUT') {
      clearTimers();
      resetDataView();
      return;
    }
    if (event === 'SIGNED_IN' && !recoverySession) {
      if (session?.user?.email?.toLowerCase() !== config.allowedEmail.toLowerCase()) {
        secureSignOut('This account is not approved for the family dashboard.');
        return;
      }
      cleanAuthHash();
      loadDashboard();
      return;
    }
    if (event === 'TOKEN_REFRESHED' && session && Date.now() - lastInteraction >= config.idleTimeoutMinutes * 60 * 1000) {
      secureSignOut('Your session closed after 30 minutes without activity. Please sign in again.');
    }
  }

  function start() {
    mountTabs();
    resetDataView();
    $('loading').classList.add('is-hidden');
    const params = new URLSearchParams(window.location.search);
    if (params.get('type') === 'recovery' || /type=(recovery|invite)/.test(window.location.hash)) {
      $('login-form-view').classList.add('is-hidden');
      $('set-password-view').classList.remove('is-hidden');
      recoverySession = true;
    }
    if (!window.supabase || !config.supabaseUrl || !config.supabasePublishableKey || config.supabasePublishableKey.startsWith('REPLACE')) {
      return setStatus('login-status', 'The dashboard is not connected to its private database yet. The site owner needs to finish the Supabase configuration.');
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storage: window.localStorage }
    });
    client.auth.onAuthStateChange(onAuthChange);
    approvedSession().then((auth) => {
      if (auth && /type=recovery/.test(window.location.hash)) {
        recoverySession = true;
        $('login-screen').classList.remove('is-hidden');
        $('login-form-view').classList.add('is-hidden');
        $('set-password-view').classList.remove('is-hidden');
        cleanAuthHash();
      } else if (auth && !recoverySession) loadDashboard();
      else if (recoverySession) {
        $('login-screen').classList.remove('is-hidden');
        $('login-form-view').classList.add('is-hidden');
        $('set-password-view').classList.remove('is-hidden');
      }
    });
  }

  $('login-form').addEventListener('submit', signIn);
  $('set-password-view').addEventListener('submit', saveNewPassword);
  $('recovery-button').addEventListener('click', requestRecovery);
  $('sign-out').addEventListener('click', () => secureSignOut('You have signed out.'));
  $('refresh-data').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    await loadDashboard();
    event.currentTarget.disabled = false;
  });
  document.querySelectorAll('[data-account-filter]').forEach((button) => button.addEventListener('click', () => {
    currentFilter = button.dataset.accountFilter;
    document.querySelectorAll('[data-account-filter]').forEach((item) => item.classList.toggle('selected', item === button));
    renderAccounts(cachedData.accounts);
  }));
  ['pointerdown', 'keydown'].forEach((eventName) => document.addEventListener(eventName, () => {
    if (activeUser && !recoverySession) armIdleTimeout();
  }, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (activeUser && Date.now() - lastInteraction >= config.idleTimeoutMinutes * 60 * 1000) {
      secureSignOut('Your session closed after 30 minutes without activity. Please sign in again.');
    } else if (activeUser) {
      approvedSession().then((auth) => { if (auth) armIdleTimeout(); });
    }
  });
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) {
      clearTimers();
      if (client) client.auth.stopAutoRefresh();
      activeUser = null;
    }
  });
  window.addEventListener('pageshow', () => {
    if (client) client.auth.startAutoRefresh();
    if (window.location.pathname !== '/' && document.getElementById('app-shell')) {
      resetDataView();
      approvedSession().then((auth) => { if (auth && !recoverySession) loadDashboard(); });
    }
  });
  start();
})();
