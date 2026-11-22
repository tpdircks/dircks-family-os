/* Physical Progress tab. Loaded only when that tab is first opened.
 * Renders into #panel-physical and never touches the finance panel. */
(() => {
  'use strict';

  const model = window.FamilyOSHealthModel;
  const $ = (id) => document.getElementById(id);
  const LANG_KEY = 'family-os-plan-lang';

  let token = 0;
  let client = null;
  let cache = null;
  let lang = 'pt';
  let optionPicks = new Map();
  let pendingDeleteId = null;
  let wired = false;
  let timeOfDay = 'morning';

  function text(value) {
    return String(value == null ? '' : value);
  }

  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = text(content);
    return node;
  }

  function escapeXml(value) {
    return text(value).replace(/[<>&'"]/g, (character) => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;'
    }[character]));
  }

  function kgText(value, digits = 1) {
    const number = model.num(value);
    if (number == null) return '—';
    return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(number)} kg`;
  }

  function pctText(value) {
    const number = model.num(value);
    if (number == null) return '—';
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(number)}%`;
  }

  function plainNumber(value, digits) {
    const number = model.num(value);
    if (number == null) return '—';
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(number);
  }

  function friendlyDate(value) {
    const day = text(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
    const parsed = new Date(`${day}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
  }

  function savedLang() {
    try {
      return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'pt';
    } catch (error) {
      return 'pt';
    }
  }

  function setLangButtons() {
    for (const [id, value] of [['lang-pt', 'pt'], ['lang-en', 'en']]) {
      const button = $(id);
      if (!button) return;
      const selected = lang === value;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  }

  function setTimeButtons() {
    document.querySelectorAll('[data-weight-time]').forEach((button) => {
      const selected = button.dataset.weightTime === timeOfDay;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function setStatus(message, success) {
    const node = $('weight-status');
    if (!node) return;
    node.textContent = message || '';
    node.classList.toggle('success', Boolean(success));
  }

  function showHealthError(message) {
    const node = $('health-error');
    if (!node) return;
    if (!message) {
      node.classList.add('is-hidden');
      node.textContent = '';
      return;
    }
    node.textContent = message;
    node.classList.remove('is-hidden');
  }

  function setHealthStatus(message) {
    const node = $('health-status');
    if (node) node.textContent = message || '';
  }

  function emptyCopy(state, emptyMessage, missingMessage) {
    if (state === 'missing') return missingMessage;
    if (state === 'error') return 'This part could not be loaded. The rest of your dashboard is unaffected.';
    return emptyMessage;
  }

  function resetPlaceholders() {
    const dashes = ['health-current', 'health-lost', 'health-to-go', 'health-goal', 'health-fat', 'health-countdown'];
    for (const id of dashes) {
      const node = $(id);
      if (node) node.textContent = '—';
    }
    const metas = {
      'health-weight-when': '',
      'health-current-meta': 'Your latest weigh-in',
      'health-progress-label': '',
      'health-goal-meta': 'From your reference assessment',
      'health-fat-meta': 'Reference assessment',
      'health-countdown-meta': 'From your active plan',
      'health-chart-caption': '',
      'plan-title': 'Meal plan'
    };
    for (const [id, value] of Object.entries(metas)) {
      const node = $(id);
      if (node) node.textContent = value;
    }
    const fill = $('health-progress-fill');
    if (fill) fill.style.width = '0%';
    const progress = $('health-progress');
    if (progress) progress.hidden = true;
    for (const id of ['health-chart', 'weighin-list', 'plan-body', 'composition-body', 'other-readings-body']) {
      const node = $(id);
      if (node) node.replaceChildren();
    }
    const method = $('composition-method');
    if (method) method.textContent = 'Reference';
    showHealthError('');
    setHealthStatus('');
    setStatus('');
    const weight = $('weight-kg');
    if (weight) weight.value = '';
    const date = $('weight-date');
    if (date) date.value = '';
    timeOfDay = 'morning';
    setTimeButtons();
    const form = $('weight-form');
    if (form) {
      form.querySelectorAll('input, button').forEach((control) => { control.disabled = false; });
    }
  }

  function clear() {
    token += 1;
    cache = null;
    optionPicks = new Map();
    pendingDeleteId = null;
    client = null;
    resetPlaceholders();
  }

  function currentModel() {
    if (!cache) {
      return model.buildViewModel({
        weighins: { rows: [], state: 'ok' },
        assessments: { rows: [], state: 'ok' },
        plans: { rows: [], state: 'ok' }
      }, lang, new Date());
    }
    return model.buildViewModel(cache, lang, new Date());
  }

  function paintHero(view) {
    const latest = view.weighins.latest;
    $('health-current').textContent = latest ? kgText(latest.weight_kg) : '—';
    const when = latest ? [timeLabel(latest.time_of_day), friendlyDate(latest.measured_on)].filter(Boolean).join(' · ') : '';
    $('health-weight-when').textContent = when;
    $('health-current-meta').textContent = latest ? 'Latest weigh-in' : (view.weighins.state === 'ok' ? 'No weigh-ins yet' : 'Weight unavailable');
    const goal = view.weighins.goal;
    $('health-goal').textContent = goal.kg == null ? '—' : kgText(goal.kg);
    $('health-goal-meta').textContent = goal.source === 'reference'
      ? 'Ideal weight from the reference assessment'
      : goal.source === 'plan'
        ? 'Read from the plan target'
        : 'No goal weight yet';
    const progress = view.weighins.progress;
    if (!latest || progress.lostKg == null) {
      $('health-lost').textContent = '—';
    } else if (progress.direction === 'gained') {
      $('health-lost').textContent = kgText(Math.abs(progress.lostKg));
    } else if (progress.direction === 'same') {
      $('health-lost').textContent = '0.0 kg';
    } else {
      $('health-lost').textContent = kgText(progress.lostKg);
    }
    const lostLabel = $('health-lost-label');
    if (lostLabel) {
      lostLabel.textContent = progress.direction === 'gained' ? 'Gained since start' : 'Lost since start';
    }
    if (progress.toGoKg == null) $('health-to-go').textContent = '—';
    else if (progress.toGoKg <= 0.049) $('health-to-go').textContent = 'Reached';
    else $('health-to-go').textContent = kgText(progress.toGoKg);
    const track = $('health-progress');
    const fill = $('health-progress-fill');
    if (progress.ratio == null) {
      track.hidden = true;
      $('health-progress-label').textContent = '';
    } else {
      track.hidden = false;
      fill.style.width = `${Math.round(progress.ratio * 100)}%`;
      const span = progress.first && goal.kg != null ? model.num(progress.first.weight_kg) - goal.kg : null;
      $('health-progress-label').textContent = progress.toGoKg != null && progress.toGoKg <= 0.049
        ? 'Goal reached.'
        : span != null && span > 0
          ? `${kgText(Math.max(0, progress.lostKg))} of ${kgText(span)} toward your goal.`
          : '';
    }
    const fat = view.reference?.stats.body_fat_pct;
    $('health-fat').textContent = pctText(fat);
    $('health-fat-meta').textContent = view.reference
      ? [view.reference.methodLabel, friendlyDate(view.reference.date)].filter(Boolean).join(' · ')
      : (view.assessmentsState === 'ok' ? 'No reference assessment yet' : 'Reference unavailable');
    $('health-countdown').textContent = view.countdown.label;
    $('health-countdown-meta').textContent = view.countdown.detail;
  }

  function timeLabel(value) {
    if (value === 'evening') return 'Evening';
    if (value === 'other') return 'Other';
    return 'Morning';
  }

  function paintChart(view) {
    const host = $('health-chart');
    host.replaceChildren();
    const points = view.weighins.points;
    const goal = view.weighins.goal.kg;
    if (view.weighins.state !== 'ok') {
      host.append(emptyState('Weight chart', emptyCopy(view.weighins.state, '', 'Your weight chart will appear when weigh-ins are connected.')));
      $('health-chart-caption').textContent = '';
      return;
    }
    if (!points.length) {
      host.append(emptyState('No weigh-ins yet', 'Save this morning’s weight and the trend starts here. Evening weigh-ins are marked separately because they usually read about 1 kg heavier.'));
      $('health-chart-caption').textContent = '';
      return;
    }
    host.insertAdjacentHTML('beforeend', chartSvg(points, goal));
    host.append(chartLegend(points, goal));
    const first = points[0];
    const last = points[points.length - 1];
    const change = last.kg - first.kg;
    const direction = change < -0.049 ? 'down' : change > 0.049 ? 'up' : 'flat';
    let caption = direction === 'flat'
      ? `Weight is flat at ${kgText(last.kg)} from ${friendlyDate(first.day)} to ${friendlyDate(last.day)}.`
      : `Weight is ${direction} ${kgText(Math.abs(change))} from ${kgText(first.kg)} on ${friendlyDate(first.day)} to ${kgText(last.kg)} on ${friendlyDate(last.day)}.`;
    caption += ' Gold diamonds are evening weigh-ins, which usually read about 1 kg heavier than morning.';
    if (goal != null) caption += ` Dashed line is the ${kgText(goal)} goal.`;
    $('health-chart-caption').textContent = caption;
  }

  function emptyState(title, copy) {
    const box = el('div', 'empty-history');
    box.append(el('div', 'empty-icon', '○'), el('h3', '', title), el('p', '', copy));
    return box;
  }

  function chartSvg(points, goal) {
    const width = 700;
    const height = 250;
    const left = 58;
    const right = 18;
    const top = 22;
    const bottom = 40;
    const values = points.map((point) => point.kg);
    if (goal != null) values.push(goal);
    let min = Math.min(...values);
    let max = Math.max(...values);
    const padding = Math.max((max - min) * 0.12, 0.6);
    min -= padding;
    max += padding;
    const t0 = points[0].at;
    const t1 = points[points.length - 1].at;
    const x = (at) => (points.length === 1
      ? left + (width - left - right) / 2
      : left + ((at - t0) / Math.max(t1 - t0, 1)) * (width - left - right));
    const y = (value) => top + ((max - value) / (max - min || 1)) * (height - top - bottom);
    let grid = '';
    for (let step = 0; step <= 3; step += 1) {
      const value = min + ((max - min) * step / 3);
      const yy = y(value);
      grid += `<line x1="${left}" x2="${width - right}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="#e4eae1" stroke-width="1" /><text x="${left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${escapeXml(plainNumber(value, 1))}</text>`;
    }
    const line = points.length > 1
      ? `<polyline class="chart-line" points="${points.map((point) => `${x(point.at).toFixed(1)},${y(point.kg).toFixed(1)}`).join(' ')}" />`
      : '';
    const area = points.length > 1
      ? `<polygon class="chart-area" points="${left},${height - bottom} ${points.map((point) => `${x(point.at).toFixed(1)},${y(point.kg).toFixed(1)}`).join(' ')} ${x(points[points.length - 1].at).toFixed(1)},${height - bottom}" />`
      : '';
    const markers = points.map((point) => {
      const cx = x(point.at);
      const cy = y(point.kg);
      if (point.timeOfDay === 'evening') {
        const size = 6;
        return `<polygon class="chart-evening" points="${cx},${(cy - size).toFixed(1)} ${(cx + size).toFixed(1)},${cy} ${cx},${(cy + size).toFixed(1)} ${(cx - size).toFixed(1)},${cy}" />`;
      }
      if (point.timeOfDay === 'other') {
        return `<rect class="chart-other" x="${(cx - 4).toFixed(1)}" y="${(cy - 4).toFixed(1)}" width="8" height="8" />`;
      }
      return `<circle class="chart-point" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" />`;
    }).join('');
    let goalLine = '';
    if (goal != null) {
      const gy = y(goal);
      const labelY = gy < top + 16 ? gy + 14 : gy - 6;
      goalLine = `<line class="chart-goal" x1="${left}" x2="${width - right}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" /><text class="chart-goal-label" x="${left + 6}" y="${labelY.toFixed(1)}">Goal ${escapeXml(plainNumber(goal, 1))}</text>`;
    }
    const first = points[0];
    const last = points[points.length - 1];
    const label = `Weight from ${first.day} to ${last.day}, ${plainNumber(first.kg, 1)} kg to ${plainNumber(last.kg, 1)} kg`;
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}"><defs><linearGradient id="weight-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5d9e77" stop-opacity=".27"/><stop offset="100%" stop-color="#5d9e77" stop-opacity="0"/></linearGradient></defs>${grid}${area}${goalLine}${line}${markers}<text x="${left}" y="${height - 8}">${escapeXml(friendlyDate(first.day))}</text><text x="${width - right}" y="${height - 8}" text-anchor="end">${escapeXml(friendlyDate(last.day))}</text></svg>`;
  }

  function chartLegend(points, goal) {
    const legend = el('div', 'chart-legend');
    legend.append(legendItem('legend-dot assets', 'Morning'));
    legend.append(legendItem('legend-diamond', 'Evening'));
    if (points.some((point) => point.timeOfDay === 'other')) legend.append(legendItem('legend-square', 'Other'));
    if (goal != null) legend.append(legendItem('legend-dash', 'Goal'));
    return legend;
  }

  function legendItem(className, label) {
    const item = el('span', 'chart-legend-item');
    const mark = el('i', className);
    mark.setAttribute('aria-hidden', 'true');
    item.append(mark, document.createTextNode(label));
    return item;
  }

  function paintWeighins(view) {
    const list = $('weighin-list');
    list.replaceChildren();
    const form = $('weight-form');
    const blocked = view.weighins.state === 'missing';
    form.querySelectorAll('input, button').forEach((control) => {
      if (control.id === 'weight-save' && control.dataset.busy === '1') return;
      control.disabled = blocked;
    });
    if (view.weighins.state !== 'ok') {
      list.append(el('p', 'small muted', emptyCopy(view.weighins.state, '', 'Logging opens when the weigh-in view is available.')));
      return;
    }
    const rows = view.weighins.rows.slice().reverse();
    if (!rows.length) {
      list.append(el('p', 'small muted', 'Nothing logged yet. Morning is selected so the next save is one number.'));
      return;
    }
    const heading = el('h3', 'weighin-heading', 'Recent weigh-ins');
    list.append(heading);
    for (const row of rows) {
      const item = el('div', `weighin-row ${row.time_of_day === 'evening' ? 'is-evening' : ''}`);
      const main = el('div', 'weighin-meta');
      main.append(el('strong', '', kgText(row.weight_kg)), el('span', '', `${timeLabel(row.time_of_day)} · ${friendlyDate(row.measured_on)}`));
      item.append(main);
      if (pendingDeleteId && pendingDeleteId === row.id) {
        const confirm = el('div', 'confirm-delete');
        confirm.append(el('span', '', 'Delete this weigh-in?'));
        const yes = el('button', 'button primary', 'Delete');
        yes.type = 'button';
        yes.dataset.confirmDelete = row.id;
        const no = el('button', 'button secondary', 'Cancel');
        no.type = 'button';
        no.dataset.cancelDelete = row.id;
        confirm.append(yes, no);
        item.append(confirm);
      } else {
        const button = el('button', 'text-button weighin-delete', 'Delete');
        button.type = 'button';
        button.dataset.deleteWeighin = row.id;
        button.setAttribute('aria-label', `Delete ${kgText(row.weight_kg)} ${timeLabel(row.time_of_day).toLowerCase()} weigh-in on ${friendlyDate(row.measured_on)}`);
        item.append(button);
      }
      list.append(item);
    }
  }

  function paintPlan(view) {
    const body = $('plan-body');
    body.replaceChildren();
    if (view.planState !== 'ok') {
      $('plan-title').textContent = 'Meal plan';
      body.append(emptyState('Plan unavailable', emptyCopy(view.planState, '', 'Today’s plan will show here when the plan view is connected.')));
      return;
    }
    if (!view.plan) {
      $('plan-title').textContent = 'Meal plan';
      body.append(emptyState('No plan yet', 'When an active plan is saved, today’s meals, hydration, and supplements show up here.'));
      return;
    }
    const plan = view.plan;
    $('plan-title').textContent = plan.title || 'Meal plan';
    if (plan.author) body.append(el('p', 'small muted plan-author', plan.author));
    if (plan.objective) body.append(paragraph('Objective', plan.objective));
    if (plan.target) body.append(paragraph('Target', plan.target));
    if (plan.frequency) body.append(paragraph('Frequency', plan.frequency));
    if (plan.hydration.min != null || plan.hydration.max != null) body.append(hydrationBlock(plan.hydration));
    if (hasMacros(plan.macros)) body.append(macroBlock(plan.macros));
    body.append(mealTimeline(plan.meals));
    if (plan.supplements.length) body.append(supplementBlock(plan.supplements));
    if (plan.tips.length) body.append(tipBlock(plan.tips));
  }

  function paragraph(label, value) {
    const block = el('div', 'plan-copy');
    block.append(el('p', 'eyebrow', label), el('p', '', value));
    return block;
  }

  function hydrationBlock(hydration) {
    const block = el('div', 'hydration-callout');
    const range = hydration.min != null && hydration.max != null
      ? `${plainNumber(hydration.min, hydration.min % 1 ? 1 : 0)}–${plainNumber(hydration.max, hydration.max % 1 ? 1 : 0)} L`
      : `${plainNumber(hydration.min ?? hydration.max, 1)} L`;
    block.append(el('span', '', 'Hydration goal'), el('strong', '', range));
    return block;
  }

  function hasMacros(macros) {
    return ['protein', 'fat', 'previousProtein', 'previousFat'].some((key) => macros[key] != null);
  }

  function macroBlock(macros) {
    const block = el('div', 'macro-block');
    block.append(el('p', 'eyebrow', 'Macros'));
    block.append(macroPair('Protein', macros.protein, macros.previousProtein));
    block.append(macroPair('Fat', macros.fat, macros.previousFat));
    return block;
  }

  function macroPair(label, current, previous) {
    const wrap = el('div', 'macro-pair');
    wrap.append(el('h3', '', label));
    if (current != null) wrap.append(macroBar(current, false, 'Now'));
    if (previous != null) wrap.append(macroBar(previous, true, 'Previous'));
    if (current == null && previous == null) wrap.append(el('p', 'small muted', '—'));
    return wrap;
  }

  function macroBar(value, previous, caption) {
    const row = el('div', 'macro-row');
    row.append(el('span', '', caption));
    const bar = el('div', `macro-bar ${previous ? 'prev' : ''}`);
    const fill = el('i');
    fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    bar.append(fill);
    bar.setAttribute('aria-hidden', 'true');
    row.append(bar, el('strong', '', pctText(value)));
    return row;
  }

  function mealTimeline(meals) {
    const list = el('ol', 'meal-timeline');
    if (!meals.length) {
      list.append(el('li', 'small muted', 'This plan has no meals yet.'));
      return list;
    }
    meals.forEach((meal, index) => {
      const item = el('li', `meal ${meal.phase ? 'is-current' : ''}`);
      item.append(el('div', 'meal-time', meal.time || '—'));
      const main = el('div', 'meal-main');
      const heading = el('div', 'meal-heading');
      heading.append(el('h3', '', meal.name || 'Meal'));
      if (meal.phase === 'now') heading.append(el('span', 'pill accent', 'Now'));
      if (meal.phase === 'next') heading.append(el('span', 'pill accent', 'Next'));
      if (meal.phase) item.setAttribute('aria-current', 'true');
      main.append(heading);
      const selected = optionPicks.has(meal.key) ? optionPicks.get(meal.key) : 0;
      const safeIndex = meal.options[selected] ? selected : 0;
      if (meal.options.length > 1) main.append(optionChips(meal, safeIndex));
      main.append(optionFoods(meal.options[safeIndex], meal.options.length > 1));
      item.append(main);
      list.append(item);
    });
    return list;
  }

  function optionChips(meal, selected) {
    const row = el('div', 'chip-row');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Meal options');
    meal.options.forEach((option, index) => {
      const chip = el('button', 'chip', option.label || (index === 0 ? (lang === 'en' ? 'Main' : 'Principal') : `${lang === 'en' ? 'Swap' : 'Substituição'} ${index}`));
      chip.type = 'button';
      chip.setAttribute('aria-pressed', index === selected ? 'true' : 'false');
      chip.dataset.mealKey = meal.key;
      chip.dataset.optionIndex = String(index);
      row.append(chip);
    });
    return row;
  }

  function optionFoods(option, swapped) {
    const wrap = el('div', 'option-foods');
    if (!option) {
      wrap.append(el('p', 'small muted', 'No foods listed for this meal.'));
      return wrap;
    }
    if (!swapped && option.label) wrap.append(el('p', 'option-label', option.label));
    if (!option.items.length) wrap.append(el('p', 'small muted', 'No foods listed for this option.'));
    const foods = el('ul', 'food-list');
    for (const item of option.items) {
      const row = el('li');
      if (item.amount) row.append(el('span', 'food-amount', item.amount));
      row.append(el('span', 'food-name', item.food || '—'));
      if (item.group) row.append(el('span', 'badge', item.group));
      foods.append(row);
    }
    if (option.items.length) wrap.append(foods);
    if (option.notes.length) {
      const notes = el('ul', 'meal-notes');
      for (const note of option.notes) notes.append(el('li', '', note));
      wrap.append(notes);
    }
    return wrap;
  }

  function supplementBlock(items) {
    const block = el('div', 'supplement-block');
    block.append(el('p', 'eyebrow', 'Supplements'));
    const list = el('ul', 'supplement-list');
    for (const item of items) {
      const row = el('li');
      const title = el('div', 'supplement-title');
      title.append(el('strong', '', item.name || 'Supplement'));
      if (item.timing) title.append(el('span', 'pill', item.timing));
      row.append(title);
      if (item.dose) row.append(el('p', 'supplement-dose', item.dose));
      if (item.note) row.append(el('p', 'small muted', item.note));
      list.append(row);
    }
    block.append(list);
    return block;
  }

  function tipBlock(tips) {
    const block = el('div', 'tip-block');
    block.append(el('p', 'eyebrow', 'Tips'));
    const list = el('ul', 'tip-list');
    for (const tip of tips) list.append(el('li', '', tip));
    block.append(list);
    return block;
  }

  function paintComposition(view) {
    const body = $('composition-body');
    body.replaceChildren();
    const method = $('composition-method');
    if (view.assessmentsState !== 'ok') {
      method.textContent = 'Reference';
      body.append(emptyState('Assessment unavailable', emptyCopy(view.assessmentsState, '', 'Body composition will show here when assessments are connected.')));
      paintOthers(view);
      return;
    }
    if (!view.reference) {
      method.textContent = 'Reference';
      body.append(emptyState('No reference assessment', 'The reference reading anchors body fat and the goal. Other readings stay in the section below and are labeled when they are estimates.'));
      paintOthers(view);
      return;
    }
    const reference = view.reference;
    method.textContent = reference.methodLabel;
    const meta = el('p', 'small muted composition-meta', [friendlyDate(reference.date), reference.assessor].filter(Boolean).join(' · '));
    body.append(meta);
    const grid = el('div', 'composition-grid');
    grid.append(statTile('Body fat', pctText(reference.stats.body_fat_pct)));
    grid.append(statTile('Fat mass', kgText(reference.stats.fat_mass_kg)));
    grid.append(statTile('Lean mass', kgText(reference.stats.lean_mass_kg)));
    const bmi = statTile('BMI', plainNumber(reference.stats.bmi, 1), 'BMI overstates body fat when lean mass is high.');
    grid.append(bmi);
    grid.append(statTile('Waist to hip', plainNumber(reference.stats.waist_hip_ratio, 2)));
    body.append(grid);
    if (reference.notes) body.append(el('p', 'small muted', reference.notes));
    if (reference.results.length) body.append(resultsTable(reference.results));
    if (reference.circumferences.length) body.append(circumferenceBlock(reference.circumferences));
    if (reference.skinfolds.length) body.append(skinfoldBlock(reference.skinfolds));
    paintOthers(view);
  }

  function statTile(label, value, note) {
    const tile = el('div', 'metric-tile');
    tile.append(el('span', '', label), el('strong', '', value));
    if (note) tile.append(el('small', '', note));
    return tile;
  }

  function resultsTable(results) {
    const wrap = el('div', 'table-wrap');
    const table = el('table');
    const head = el('thead');
    const headRow = el('tr');
    for (const label of ['Result', 'Value', 'Status', 'Recommendation']) {
      const cell = el('th', '', label);
      cell.scope = 'col';
      headRow.append(cell);
    }
    head.append(headRow);
    const body = el('tbody');
    for (const result of results) {
      const row = el('tr');
      row.append(el('td', '', result.label || '—'));
      const value = result.value == null ? '—' : `${text(result.value)}${result.unit ? ` ${result.unit}` : ''}`;
      row.append(el('td', '', value));
      const statusCell = el('td');
      if (result.status) {
        const pill = el('span', `pill status-pill ${result.statusTone}`, result.status);
        statusCell.append(pill);
      } else statusCell.textContent = '—';
      row.append(statusCell);
      row.append(el('td', '', result.recommendation || '—'));
      body.append(row);
    }
    table.append(head, body);
    wrap.append(table);
    return wrap;
  }

  function circumferenceBlock(items) {
    const block = el('div', 'measure-block');
    block.append(el('p', 'eyebrow', 'Circumferences'));
    const grid = el('div', 'circ-grid');
    for (const item of items) {
      const tile = el('div', 'metric-tile');
      tile.append(el('span', '', item.label), el('strong', '', `${plainNumber(item.value, 1)} cm`));
      grid.append(tile);
    }
    block.append(grid);
    return block;
  }

  function skinfoldBlock(items) {
    const block = el('div', 'measure-block');
    block.append(el('p', 'eyebrow', 'Skinfolds'));
    const max = Math.max(...items.map((item) => item.value), 1);
    const chart = el('div', 'skinfold-chart');
    for (const item of items) {
      const row = el('div', 'skinfold-row');
      row.append(el('span', '', item.label));
      const bar = el('div', 'macro-bar');
      const fill = el('i');
      fill.style.width = `${Math.max(4, (item.value / max) * 100)}%`;
      bar.append(fill);
      row.append(bar, el('strong', '', `${plainNumber(item.value, 0)} mm`));
      chart.append(row);
    }
    block.append(chart);
    return block;
  }

  function paintOthers(view) {
    const body = $('other-readings-body');
    body.replaceChildren();
    body.append(el('p', 'small muted other-intro', 'Bioimpedance and smart scale readings are estimates. The reference assessment is the card above.'));
    if (view.assessmentsState !== 'ok') {
      body.append(el('p', 'small muted', emptyCopy(view.assessmentsState, '', 'Other readings are not connected yet.')));
      return;
    }
    if (!view.others.length) {
      body.append(el('p', 'small muted', 'No other readings yet.'));
      return;
    }
    for (const reading of view.others) body.append(readingCard(reading));
  }

  function readingCard(reading) {
    const card = el('article', 'reading');
    const heading = el('div', 'reading-heading');
    heading.append(el('h3', '', reading.methodLabel));
    if (reading.isEstimate) heading.append(el('span', 'pill estimate-pill', 'Estimate'));
    card.append(heading);
    card.append(el('p', 'small muted', [friendlyDate(reading.date), reading.assessor].filter(Boolean).join(' · ')));
    const bits = [];
    if (reading.stats.weight_kg != null) bits.push(['Weight', kgText(reading.stats.weight_kg)]);
    if (reading.stats.body_fat_pct != null) bits.push(['Body fat', pctText(reading.stats.body_fat_pct)]);
    if (reading.stats.lean_mass_kg != null) bits.push(['Lean mass', kgText(reading.stats.lean_mass_kg)]);
    if (reading.stats.fat_mass_kg != null) bits.push(['Fat mass', kgText(reading.stats.fat_mass_kg)]);
    if (bits.length) {
      const grid = el('div', 'reading-stats');
      for (const [label, value] of bits) {
        const tile = el('div');
        tile.append(el('span', '', label), el('strong', '', value));
        grid.append(tile);
      }
      card.append(grid);
    }
    if (reading.results.length) card.append(resultsTable(reading.results));
    if (reading.notes) card.append(el('p', 'small muted', reading.notes));
    return card;
  }

  function paint() {
    const view = currentModel();
    const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
    $('health-today').textContent = today.toUpperCase();
    setLangButtons();
    paintHero(view);
    paintChart(view);
    paintWeighins(view);
    paintPlan(view);
    paintComposition(view);
    const date = $('weight-date');
    if (date) {
      date.max = model.localISODate(new Date());
      if (!date.value) date.value = date.max;
    }
  }

  async function readView(api, name, columns) {
    const { data, error } = await api.from(name).select(columns);
    if (error) return { rows: [], state: model.viewState(error), error };
    return { rows: data || [], state: 'ok', error: null };
  }

  async function fetchAll(activeClient) {
    const api = activeClient.schema('family_api');
    const [weighins, assessments, plans] = await Promise.all([
      readView(api, 'health_weighins', 'id,measured_on,time_of_day,weight_kg,source,note,created_at'),
      readView(api, 'health_assessments', 'id,assessed_on,method,assessor,is_reference,summary,measurements,results,notes,created_at'),
      readView(api, 'health_plans', 'id,plan_date,title,goal,is_active,data,created_at')
    ]);
    return { weighins, assessments, plans };
  }

  async function load(context) {
    const current = ++token;
    client = context?.client || client;
    if (!client) {
      showHealthError('Physical progress is not connected yet. Finances are unaffected.');
      return;
    }
    if (!model) throw new Error('Physical progress helpers did not load.');
    wire();
    lang = savedLang();
    setHealthStatus('Loading your progress…');
    showHealthError('');
    let bundle;
    try {
      bundle = await fetchAll(client);
    } catch (error) {
      if (current !== token) return;
      console.error('Physical progress request failed.', error);
      setHealthStatus('');
      showHealthError('Your physical progress could not be loaded. Finances are unaffected.');
      return;
    }
    if (current !== token) return;
    cache = bundle;
    setHealthStatus('');
    const failures = [bundle.weighins, bundle.assessments, bundle.plans].filter((item) => item.state === 'error');
    const missing = [bundle.weighins, bundle.assessments, bundle.plans].filter((item) => item.state === 'missing');
    if (failures.length && failures.length === 3) {
      showHealthError('Your physical progress could not be loaded. Finances are unaffected.');
    } else if (missing.length === 3) {
      showHealthError('Health views are not available yet. You can keep using Finances.');
    } else if (failures.length) {
      showHealthError('Part of physical progress could not be loaded. Everything that loaded is shown below.');
    } else {
      showHealthError('');
    }
    try {
      paint();
    } catch (error) {
      console.error('Physical progress could not be drawn.', error);
      showHealthError('Your physical progress could not be shown. Finances are unaffected.');
    }
  }

  async function onSave(event) {
    event.preventDefault();
    if (!client || !cache) return setStatus('Still loading. Try again in a moment.');
    const prepared = model.weighInPayload({
      measuredOn: $('weight-date').value,
      weightKg: $('weight-kg').value.trim().replace(',', '.'),
      timeOfDay
    });
    if (prepared.errors.includes('weight')) return setStatus('Enter a weight in kilograms.');
    if (prepared.errors.includes('range')) return setStatus('Enter a weight between 30 and 250 kg.');
    if (prepared.errors.includes('date')) return setStatus('Choose the day you weighed in.');
    if (prepared.payload.measured_on > model.localISODate(new Date())) return setStatus('Choose today or an earlier day.');
    const button = $('weight-save');
    button.disabled = true;
    button.dataset.busy = '1';
    setStatus('Saving…', true);
    const api = client.schema('family_api');
    const { error } = await api.from('health_weighins').insert(prepared.payload).select('id');
    button.disabled = false;
    button.dataset.busy = '';
    if (error) {
      console.error('Weigh-in save failed.', error);
      setStatus(model.isMissingRelation(error)
        ? 'Weigh-ins are not available yet.'
        : 'That weigh-in could not be saved. Please try again.');
      return;
    }
    $('weight-kg').value = '';
    timeOfDay = 'morning';
    setTimeButtons();
    setStatus('Saved.', true);
    await load({ client });
    $('weight-kg').focus();
  }

  async function onListClick(event) {
    const remove = event.target.closest('[data-delete-weighin]');
    const confirm = event.target.closest('[data-confirm-delete]');
    const cancel = event.target.closest('[data-cancel-delete]');
    if (remove) {
      pendingDeleteId = remove.dataset.deleteWeighin;
      paintWeighins(currentModel());
      return;
    }
    if (cancel) {
      pendingDeleteId = null;
      paintWeighins(currentModel());
      return;
    }
    if (!confirm || !client) return;
    const id = confirm.dataset.confirmDelete;
    confirm.disabled = true;
    const api = client.schema('family_api');
    const { error } = await api.from('health_weighins').delete().eq('id', id);
    if (error) {
      console.error('Weigh-in delete failed.', error);
      setStatus('That weigh-in could not be deleted. Please try again.');
      confirm.disabled = false;
      return;
    }
    pendingDeleteId = null;
    setStatus('Weigh-in deleted.', true);
    await load({ client });
  }

  function onOptionClick(event) {
    const chip = event.target.closest('[data-meal-key]');
    if (!chip) return;
    optionPicks.set(chip.dataset.mealKey, Number(chip.dataset.optionIndex));
    paintPlan(currentModel());
  }

  function onRefresh() {
    const button = $('health-refresh');
    button.disabled = true;
    load({ client }).finally(() => { button.disabled = false; });
  }

  function wire() {
    if (wired) return;
    wired = true;
    $('weight-form').addEventListener('submit', onSave);
    $('weighin-list').addEventListener('click', onListClick);
    $('plan-body').addEventListener('click', onOptionClick);
    $('health-refresh').addEventListener('click', onRefresh);
    $('lang-pt').addEventListener('click', () => chooseLang('pt'));
    $('lang-en').addEventListener('click', () => chooseLang('en'));
    document.querySelectorAll('[data-weight-time]').forEach((button) => {
      button.addEventListener('click', () => {
        timeOfDay = button.dataset.weightTime;
        setTimeButtons();
      });
    });
    setTimeButtons();
  }

  function chooseLang(next) {
    lang = next === 'en' ? 'en' : 'pt';
    try { localStorage.setItem(LANG_KEY, lang); } catch (error) { /* storage off */ }
    setLangButtons();
    if (cache) {
      paintPlan(currentModel());
      paintComposition(currentModel());
    }
  }

  window.FamilyOSPhysical = { load, clear };
})();
