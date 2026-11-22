import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const model = createRequire(import.meta.url)('../health-model.js');

/* Clearly fake demo values. Nothing here is a real weigh-in, measurement, or plan. */
const NOW = new Date(2026, 10, 22, 10, 30, 0);

function fakeBundle() {
  return {
    weighins: {
      state: 'ok',
      rows: [
        { id: 'w1', measured_on: '2026-10-01', time_of_day: 'morning', weight_kg: '100.0', created_at: '2026-10-01T08:00:00Z' },
        { id: 'w2', measured_on: '2026-10-01', time_of_day: 'evening', weight_kg: 101.2, created_at: '2026-10-01T20:00:00Z' },
        { id: 'w3', measured_on: '2026-11-20', time_of_day: 'morning', weight_kg: 95, created_at: '2026-11-20T08:00:00Z' }
      ]
    },
    assessments: {
      state: 'ok',
      rows: [
        {
          id: 'a-estimate',
          assessed_on: '2026-11-01',
          method: 'bioimpedance',
          is_reference: false,
          summary: { body_fat_pct: 26, weight_kg: 96 },
          measurements: {},
          results: [{ label_pt: 'Gordura demo', value: 26, unit: '%' }]
        },
        {
          id: 'a-ref',
          assessed_on: '2026-09-01',
          method: 'skinfold',
          assessor: 'Demo Author',
          is_reference: true,
          summary: { weight_kg: 100, body_fat_pct: 24, fat_mass_kg: 24, lean_mass_kg: 76, bmi: 27, waist_hip_ratio: 0.86, ideal_weight_kg: 90 },
          measurements: {
            circumferences_cm: { waist: 90, hip: 100 },
            skinfolds_mm: { biceps: 10, abdominal: 20 }
          },
          results: [
            { label_pt: 'Percentual demo', label_en: 'Demo body fat', value: 24, unit: '%', recommendation: 'Demo recommendation only.', status_pt: 'Adequado', status_en: 'Within range' },
            { label_pt: 'Sem detalhe', label_en: 'No detail', value: 1, unit: 'score' }
          ]
        },
        {
          id: 'a-scale',
          assessed_on: '2026-11-18',
          method: 'smart_scale',
          is_reference: false,
          summary: '{"weight_kg":96}',
          results: []
        }
      ]
    },
    plans: {
      state: 'ok',
      rows: [
        {
          id: 'p1',
          plan_date: '2026-11-01',
          title: 'Demo plan',
          goal: 'Sample goal',
          is_active: true,
          data: {
            author: 'Demo Author',
            objective_pt: 'Objetivo demo, sem correção.',
            objective_en: 'Demo objective.',
            target_pt: 'Chegar a 80 kg',
            target_en: 'Reach 80 kg',
            frequency_pt: 'Todos os dias',
            frequency_en: 'Every day',
            macros: { protein_pct: 30, fat_pct: 25, previous: { protein_pct: 20, fat_pct: 35 } },
            hydration: { liters_min: 2.5, liters_max: 3.5 },
            supplements: [{ name_pt: 'Vitamina demo', name_en: 'Demo vitamin', dose: '1 capsule', timing: 'Morning', note_pt: 'Nota demo.', note_en: 'Demo note.' }],
            next_assessment: '2026-12-06T09:00:00',
            tips: [{ pt: 'Beba agua.', en: 'Drink water.' }],
            meals: [
              { time: '12:30', name_pt: 'Almoco demo', name_en: 'Demo lunch', options: [{ label_pt: 'Principal', label_en: 'Main', items: [{ food_pt: 'Arroz demo', food_en: 'Demo rice', amount: '100 g' }], notes_pt: [], notes_en: [] }] },
              {
                time: '07:00',
                name_pt: 'Cafe demo',
                name_en: 'Demo breakfast',
                options: [
                  {
                    label_pt: 'Principal',
                    label_en: 'Main',
                    items: [{ food_pt: 'Iogutrte natural', food_en: 'Demo yogurt', amount: 'Copo médio: 200 ml', group_pt: 'Laticinio' }],
                    notes_pt: [],
                    notes_en: ['This English note must not replace an empty Portuguese list.']
                  },
                  {
                    label_pt: 'Substituiçao',
                    label_en: 'Swap',
                    items: [{ food_pt: 'Fruta demo', food_en: 'Demo fruit', amount: 'à vontade' }],
                    notes_pt: ['Nao adocicar.'],
                    notes_en: ['Do not sweeten.']
                  }
                ]
              }
            ]
          }
        }
      ]
    }
  };
}

test('sorts morning before evening on the same day and keeps kilograms numeric', () => {
  const ordered = model.sortWeighins(fakeBundle().weighins.rows);
  assert.deepEqual(ordered.map((row) => row.id), ['w1', 'w2', 'w3']);
  const points = model.chartPoints(ordered);
  assert.equal(points[1].timeOfDay, 'evening');
  assert.equal(points[2].kg, 95);
  assert.ok(points[1].at > points[0].at);
});

test('uses the reference ideal weight and ignores the plan target when both exist', () => {
  const prepared = fakeBundle();
  const reference = model.referenceAssessment(prepared.assessments.rows.map((row) => ({ ...row, summary: typeof row.summary === 'string' ? JSON.parse(row.summary) : row.summary })));
  const plan = model.activePlan(prepared.plans.rows);
  assert.equal(reference.id, 'a-ref');
  assert.deepEqual(model.goalWeight(reference, plan), { kg: 90, source: 'reference' });
  assert.deepEqual(model.goalWeight(null, plan), { kg: 80, source: 'plan' });
  assert.equal(model.weightFromText('Week 12, no unit'), null);
  assert.equal(model.weightFromText('Meta 79,5 kg'), 79.5);
});

test('computes lost, remaining, and progress from the first weigh-in', () => {
  const stats = model.progressStats(fakeBundle().weighins.rows, 90);
  assert.equal(stats.lostKg, 5);
  assert.equal(stats.toGoKg, 5);
  assert.equal(stats.ratio, 0.5);
  assert.equal(stats.direction, 'lost');
  const gained = model.progressStats([
    { measured_on: '2026-01-01', time_of_day: 'morning', weight_kg: 90 },
    { measured_on: '2026-02-01', time_of_day: 'morning', weight_kg: 92 }
  ], 80);
  assert.equal(gained.direction, 'gained');
  assert.equal(gained.ratio, 0);
});

test('highlights the current meal by local time and keeps plan text verbatim', () => {
  const view = model.buildViewModel(fakeBundle(), 'pt', NOW);
  assert.equal(view.plan.meals.map((meal) => meal.time).join(','), '07:00,12:30');
  assert.equal(view.plan.meals[0].phase, 'now');
  assert.equal(view.plan.meals[1].phase, '');
  const breakfast = view.plan.meals[0];
  assert.equal(breakfast.options[0].items[0].food, 'Iogutrte natural');
  assert.equal(breakfast.options[0].items[0].amount, 'Copo médio: 200 ml');
  assert.deepEqual(breakfast.options[0].notes, []);
  assert.equal(breakfast.options[1].label, 'Substituiçao');
  assert.deepEqual(breakfast.options[1].notes, ['Nao adocicar.']);
  assert.equal(view.plan.objective, 'Objetivo demo, sem correção.');
  assert.equal(view.plan.tips[0], 'Beba agua.');
  const english = model.buildViewModel(fakeBundle(), 'en', NOW);
  assert.equal(english.plan.meals[0].options[0].items[0].food, 'Demo yogurt');
  assert.equal(english.plan.meals[0].options[1].notes[0], 'Do not sweeten.');
  assert.equal(english.reference.results[1].recommendation, '');
  assert.equal(english.reference.results[1].status, '');
  assert.equal(english.reference.results[0].status, 'Within range');
});

test('keeps estimates out of the reference card and tolerates missing views', () => {
  const early = new Date(2026, 10, 22, 6, 0, 0);
  const view = model.buildViewModel(fakeBundle(), 'pt', early);
  assert.equal(view.plan.meals[0].phase, 'next');
  assert.equal(view.reference.method, 'skinfold');
  assert.equal(view.reference.isEstimate, false);
  assert.deepEqual(view.others.map((item) => item.method), ['smart_scale', 'bioimpedance']);
  assert.equal(view.others.every((item) => item.isEstimate), true);
  assert.equal(view.reference.circumferences[0].label, 'Waist');
  assert.equal(view.countdown.label.endsWith('days'), true);
  const missing = model.buildViewModel({
    weighins: { rows: [], state: 'missing' },
    assessments: { rows: [], state: 'missing' },
    plans: { rows: [], state: 'missing' }
  }, 'pt', NOW);
  assert.equal(missing.reference, null);
  assert.equal(missing.plan, null);
  assert.equal(missing.weighins.rows.length, 0);
  assert.equal(model.isMissingRelation({ code: 'PGRST205', message: "Could not find the table 'family_api.health_weighins' in the schema cache" }), true);
  assert.equal(model.isMissingRelation({ code: '42P01', message: 'relation "family_api.health_plans" does not exist' }), true);
  assert.equal(model.isMissingRelation({ status: 404, message: 'Not Found' }), true);
  assert.equal(model.isMissingRelation({ message: 'permission denied' }), false);
});

test('builds an insert payload with only the columns the app is allowed to send', () => {
  const good = model.weighInPayload({ measuredOn: '2026-11-22', weightKg: '95,5', timeOfDay: 'evening' });
  assert.deepEqual(good.errors, []);
  assert.deepEqual(Object.keys(good.payload).sort(), ['measured_on', 'time_of_day', 'weight_kg']);
  assert.equal(good.payload.weight_kg, 95.5);
  assert.equal(good.payload.time_of_day, 'evening');
  assert.ok(model.weighInPayload({ measuredOn: '2026-11-22', weightKg: '10', timeOfDay: 'morning' }).errors.includes('range'));
  assert.ok(model.weighInPayload({ measuredOn: '', weightKg: '90', timeOfDay: 'nope' }).errors.includes('date'));
  assert.equal(model.weighInPayload({ measuredOn: '2026-11-22', weightKg: '90', timeOfDay: 'nope' }).payload.time_of_day, 'morning');
});
