/* Pure helpers for the Physical Progress tab.
 * No network, no DOM, no personal data. Plan strings are returned unchanged. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FamilyOSHealthModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TIME_RANK = { morning: 0, evening: 1, other: 2 };
  const METHOD_LABELS = { skinfold: 'Skinfold', bioimpedance: 'Bioimpedance', smart_scale: 'Smart scale' };
  const CIRCUMFERENCES = [
    ['chest', 'Chest'],
    ['abdomen', 'Abdomen'],
    ['waist', 'Waist'],
    ['hip', 'Hip'],
    ['right_thigh', 'Right thigh'],
    ['right_calf', 'Right calf'],
    ['neck', 'Neck'],
    ['right_arm_relaxed', 'Right arm']
  ];
  const SKINFOLDS = [
    ['biceps', 'Biceps'],
    ['triceps', 'Triceps'],
    ['midaxillary', 'Midaxillary'],
    ['chest', 'Chest'],
    ['abdominal', 'Abdominal'],
    ['suprailiac', 'Suprailiac'],
    ['subscapular', 'Subscapular'],
    ['thigh', 'Thigh'],
    ['medial_calf', 'Medial calf']
  ];

  function num(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function asJson(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed == null ? fallback : parsed;
      } catch (error) {
        return fallback;
      }
    }
    return value;
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

  function viewState(error) {
    if (!error) return 'ok';
    return isMissingRelation(error) ? 'missing' : 'error';
  }

  function pickLang(row, lang, ptKey, enKey) {
    if (!row || typeof row !== 'object') return '';
    const preferred = lang === 'en' ? row[enKey] : row[ptKey];
    if (preferred != null && String(preferred) !== '') return String(preferred);
    const alternate = lang === 'en' ? row[ptKey] : row[enKey];
    if (alternate != null && String(alternate) !== '') return String(alternate);
    return '';
  }

  function weightFromText(value) {
    const match = String(value || '').match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
    if (!match) return null;
    return num(match[1]);
  }

  function sortWeighins(rows) {
    return [...(rows || [])].sort((a, b) => {
      const day = String(a.measured_on || '').localeCompare(String(b.measured_on || ''));
      if (day) return day;
      const time = (TIME_RANK[a.time_of_day] ?? 9) - (TIME_RANK[b.time_of_day] ?? 9);
      if (time) return time;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
  }

  function pointTime(row) {
    const day = String(row.measured_on || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const hours = row.time_of_day === 'evening' ? 20 : row.time_of_day === 'other' ? 14 : 8;
    const at = new Date(`${day}T${String(hours).padStart(2, '0')}:00:00`);
    const time = at.getTime();
    return Number.isNaN(time) ? null : time;
  }

  function chartPoints(rows) {
    return sortWeighins(rows).map((row) => ({
      id: row.id,
      at: pointTime(row),
      day: String(row.measured_on || '').slice(0, 10),
      kg: num(row.weight_kg),
      timeOfDay: TIME_RANK[row.time_of_day] != null ? row.time_of_day : 'other'
    })).filter((point) => point.at != null && point.kg != null);
  }

  function goalWeight(reference, plan) {
    const ideal = num(reference?.summary?.ideal_weight_kg);
    if (ideal != null) return { kg: ideal, source: 'reference' };
    const data = plan?.data && typeof plan.data === 'object' ? plan.data : {};
    const fromPlan = weightFromText(data.target_pt)
      ?? weightFromText(data.target_en)
      ?? weightFromText(plan?.goal)
      ?? weightFromText(data.target);
    if (fromPlan != null) return { kg: fromPlan, source: 'plan' };
    return { kg: null, source: null };
  }

  function progressStats(rows, goalKg) {
    const ordered = sortWeighins(rows).filter((row) => num(row.weight_kg) != null);
    if (!ordered.length) {
      return { current: null, first: null, lostKg: null, toGoKg: null, ratio: null, direction: null };
    }
    const first = ordered[0];
    const current = ordered[ordered.length - 1];
    const firstKg = num(first.weight_kg);
    const currentKg = num(current.weight_kg);
    const lostKg = firstKg - currentKg;
    const toGoKg = goalKg == null ? null : currentKg - goalKg;
    let ratio = null;
    if (goalKg != null) {
      const span = firstKg - goalKg;
      if (span > 0) ratio = Math.max(0, Math.min(1, lostKg / span));
      else if (currentKg <= goalKg) ratio = 1;
      else ratio = 0;
    }
    const direction = lostKg > 0.049 ? 'lost' : lostKg < -0.049 ? 'gained' : 'same';
    return { current, first, lostKg, toGoKg, ratio, direction };
  }

  function isReferenceFlag(value) {
    return value === true || value === 'true' || value === 't';
  }

  function referenceAssessment(rows) {
    const matches = (rows || []).filter((row) => isReferenceFlag(row.is_reference));
    matches.sort((a, b) => String(b.assessed_on || '').localeCompare(String(a.assessed_on || '')));
    return matches[0] || null;
  }

  function otherAssessments(rows, reference) {
    return (rows || [])
      .filter((row) => row !== reference && (!reference || row.id !== reference.id))
      .sort((a, b) => String(b.assessed_on || '').localeCompare(String(a.assessed_on || '')));
  }

  function activePlan(rows) {
    const plans = [...(rows || [])].sort((a, b) => String(b.plan_date || '').localeCompare(String(a.plan_date || '')));
    return plans.find((plan) => plan.is_active === true || plan.is_active === 'true') || plans[0] || null;
  }

  function mealMinutes(time) {
    const match = String(time || '').match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function activeMeal(meals, nowMinutes) {
    const indexed = (meals || []).map((meal, index) => ({ index, minutes: mealMinutes(meal.time) }))
      .filter((item) => item.minutes != null)
      .sort((a, b) => a.minutes - b.minutes || a.index - b.index);
    if (!indexed.length) return { index: -1, phase: '' };
    const started = indexed.filter((item) => item.minutes <= nowMinutes);
    if (!started.length) return { index: indexed[0].index, phase: 'next' };
    return { index: started[started.length - 1].index, phase: 'now' };
  }

  function countdown(iso, now) {
    if (!iso) return { label: '—', detail: 'No assessment scheduled' };
    const target = new Date(iso);
    if (Number.isNaN(target.getTime())) return { label: '—', detail: 'Date not set' };
    const moment = now instanceof Date ? now : new Date();
    const ms = target.getTime() - moment.getTime();
    const detail = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    }).format(target);
    if (ms <= 0) return { label: 'Due', detail };
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days >= 2) return { label: `${days} days`, detail };
    if (days === 1) return { label: 'Tomorrow', detail };
    if (hours >= 1) return { label: `${hours} hour${hours === 1 ? '' : 's'}`, detail };
    const minutes = Math.max(1, Math.floor(ms / 60000));
    return { label: `${minutes} min`, detail };
  }

  function statusTone(status) {
    const value = String(status || '').toLowerCase();
    if (!value) return '';
    if (/adequ|ideal|normal|bom|ok|good|within|ótim|otim|saudav|excellent/.test(value)) return 'good';
    if (/alto|elev|high|aten|acima|excess|risco|low|baixo|watch/.test(value)) return 'watch';
    return '';
  }

  function measurementList(source, fields) {
    const bag = source && typeof source === 'object' ? source : {};
    return fields.map(([key, label]) => {
      const value = num(bag[key]);
      return value == null ? null : { key, label, value };
    }).filter(Boolean);
  }

  function assessmentView(row, lang) {
    if (!row) return null;
    const summary = asJson(row.summary, {}) || {};
    const measurements = asJson(row.measurements, {}) || {};
    const results = asJson(row.results, []) || [];
    const method = METHOD_LABELS[row.method] ? row.method : 'other';
    return {
      id: row.id,
      method,
      methodLabel: METHOD_LABELS[row.method] || String(row.method || 'Reading'),
      date: String(row.assessed_on || '').slice(0, 10),
      assessor: row.assessor ? String(row.assessor) : '',
      notes: row.notes ? String(row.notes) : '',
      isEstimate: method === 'bioimpedance' || method === 'smart_scale',
      stats: {
        weight_kg: num(summary.weight_kg),
        height_m: num(summary.height_m),
        body_fat_pct: num(summary.body_fat_pct),
        fat_mass_kg: num(summary.fat_mass_kg),
        lean_mass_kg: num(summary.lean_mass_kg),
        bmi: num(summary.bmi),
        waist_hip_ratio: num(summary.waist_hip_ratio)
      },
      circumferences: measurementList(measurements.circumferences_cm, CIRCUMFERENCES),
      skinfolds: measurementList(measurements.skinfolds_mm, SKINFOLDS),
      results: (Array.isArray(results) ? results : []).map((item) => {
        const status = pickLang(item, lang, 'status_pt', 'status_en');
        return {
          label: pickLang(item, lang, 'label_pt', 'label_en'),
          value: item && item.value != null && item.value !== '' ? item.value : null,
          unit: item && item.unit != null ? String(item.unit) : '',
          recommendation: item && item.recommendation != null ? String(item.recommendation) : '',
          status,
          statusTone: statusTone(status)
        };
      })
    };
  }

  function planView(plan, lang, now) {
    if (!plan) return null;
    const data = asJson(plan.data, {}) || {};
    const meals = Array.isArray(data.meals) ? data.meals.slice() : [];
    meals.sort((a, b) => {
      const am = mealMinutes(a.time);
      const bm = mealMinutes(b.time);
      if (am == null && bm == null) return 0;
      if (am == null) return 1;
      if (bm == null) return -1;
      return am - bm;
    });
    const moment = now instanceof Date ? now : new Date();
    const marker = activeMeal(meals, moment.getHours() * 60 + moment.getMinutes());
    const macros = data.macros && typeof data.macros === 'object' ? data.macros : {};
    const previous = macros.previous && typeof macros.previous === 'object' ? macros.previous : {};
    const hydration = data.hydration && typeof data.hydration === 'object' ? data.hydration : {};
    return {
      title: plan.title ? String(plan.title) : '',
      author: data.author ? String(data.author) : '',
      objective: pickLang(data, lang, 'objective_pt', 'objective_en'),
      target: pickLang(data, lang, 'target_pt', 'target_en'),
      frequency: pickLang(data, lang, 'frequency_pt', 'frequency_en'),
      hydration: { min: num(hydration.liters_min), max: num(hydration.liters_max) },
      macros: {
        protein: num(macros.protein_pct),
        fat: num(macros.fat_pct),
        previousProtein: num(previous.protein_pct),
        previousFat: num(previous.fat_pct)
      },
      meals: meals.map((meal, index) => ({
        key: `${meal.time || ''}|${meal.name_pt || ''}|${meal.name_en || ''}|${index}`,
        time: meal.time ? String(meal.time) : '',
        name: pickLang(meal, lang, 'name_pt', 'name_en'),
        phase: index === marker.index ? marker.phase : '',
        options: (Array.isArray(meal.options) ? meal.options : []).map((option) => {
          const notes = lang === 'en' ? option?.notes_en : option?.notes_pt;
          return {
            label: pickLang(option, lang, 'label_pt', 'label_en'),
            items: (Array.isArray(option?.items) ? option.items : []).map((item) => ({
              amount: item?.amount == null ? '' : String(item.amount),
              food: pickLang(item, lang, 'food_pt', 'food_en'),
              group: item?.group_pt ? String(item.group_pt) : ''
            })),
            notes: Array.isArray(notes) ? notes.filter((note) => note != null && String(note) !== '').map(String) : []
          };
        })
      })),
      supplements: (Array.isArray(data.supplements) ? data.supplements : []).map((item) => ({
        name: pickLang(item, lang, 'name_pt', 'name_en'),
        dose: item?.dose == null ? '' : String(item.dose),
        timing: item?.timing == null ? '' : String(item.timing),
        note: pickLang(item, lang, 'note_pt', 'note_en')
      })),
      tips: (Array.isArray(data.tips) ? data.tips : []).map((tip) => pickLang(tip, lang, 'pt', 'en')).filter(Boolean)
    };
  }

  function prepareRows(bundle) {
    const weighins = sortWeighins(bundle.weighins?.rows).map((row) => ({ ...row, weight_kg: num(row.weight_kg) }));
    const assessments = (bundle.assessments?.rows || []).map((row) => ({
      ...row,
      summary: asJson(row.summary, {}),
      measurements: asJson(row.measurements, {}),
      results: asJson(row.results, [])
    }));
    const plans = (bundle.plans?.rows || []).map((row) => ({ ...row, data: asJson(row.data, {}) }));
    return { weighins, assessments, plans };
  }

  function buildViewModel(bundle, lang, now) {
    const language = lang === 'en' ? 'en' : 'pt';
    const moment = now instanceof Date ? now : new Date();
    const prepared = prepareRows(bundle || {});
    const referenceRow = referenceAssessment(prepared.assessments);
    const planRow = activePlan(prepared.plans);
    const goal = goalWeight(referenceRow, planRow);
    const progress = progressStats(prepared.weighins, goal.kg);
    return {
      lang: language,
      weighins: {
        state: bundle?.weighins?.state || 'ok',
        rows: prepared.weighins,
        latest: progress.current,
        first: progress.first,
        progress,
        goal,
        points: chartPoints(prepared.weighins)
      },
      assessmentsState: bundle?.assessments?.state || 'ok',
      reference: assessmentView(referenceRow, language),
      others: otherAssessments(prepared.assessments, referenceRow).map((row) => assessmentView(row, language)),
      planState: bundle?.plans?.state || 'ok',
      plan: planView(planRow, language, moment),
      countdown: countdown(planRow?.data?.next_assessment, moment)
    };
  }

  function weighInPayload(input) {
    const weight = num(input?.weightKg);
    const timeOfDay = ['morning', 'evening', 'other'].includes(input?.timeOfDay) ? input.timeOfDay : 'morning';
    const measuredOn = String(input?.measuredOn || '');
    const errors = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredOn)) errors.push('date');
    if (weight == null) errors.push('weight');
    else if (weight < 30 || weight > 250) errors.push('range');
    return {
      errors,
      payload: errors.length ? null : { measured_on: measuredOn, weight_kg: Math.round(weight * 100) / 100, time_of_day: timeOfDay }
    };
  }

  function localISODate(date) {
    const moment = date instanceof Date ? date : new Date();
    const month = String(moment.getMonth() + 1).padStart(2, '0');
    const day = String(moment.getDate()).padStart(2, '0');
    return `${moment.getFullYear()}-${month}-${day}`;
  }

  return {
    METHOD_LABELS,
    num,
    asJson,
    isMissingRelation,
    viewState,
    pickLang,
    weightFromText,
    sortWeighins,
    chartPoints,
    goalWeight,
    progressStats,
    referenceAssessment,
    otherAssessments,
    activePlan,
    mealMinutes,
    activeMeal,
    countdown,
    statusTone,
    buildViewModel,
    weighInPayload,
    localISODate
  };
});
