# Dircks Family OS

Private static dashboard. Finances stay the default view. Physical Progress is a second tab. Both read `family_api` only after an approved sign-in. This repository is public: do not commit weights, measurements, meal contents, or other personal records. Those values load at runtime.

## Tabs

Tabs are one list in `app.js`:

```js
const TABS = [
  { id: 'finances', label: 'Finances', load: loadFinances, clear: clearFinances },
  { id: 'physical', label: 'Physical Progress', load: loadPhysicalTab, clear: clearPhysicalTab }
];
```

Each entry owns exactly one panel:

```html
<section id="panel-calendar" data-tab-panel="calendar" role="tabpanel" hidden></section>
```

The tab bar is built from `TABS`. Switching uses the `id` only (`data-tab` on the button, `data-tab-panel` on the section). Arrow keys, Home, and End move the selection. The selected tab id is stored in `localStorage` under `family-os-tab`. Do not store dashboard data there.

`load` runs the first time that tab is opened. `clear` runs on sign-out and must remove every personal value from the panel and from memory. A thrown `load` is caught for that tab, so one section cannot take down another. Finances still load first on sign-in.

### Add a tab

1. Add one object to `TABS` in `app.js` (`id`, `label`, optional `load`, optional `clear`).
2. Add one `<section data-tab-panel="that-id">` in `index.html` and `404.html`.
3. Put the render body in its own file and lazy-load it from `load`, the same way `loadPhysicalTab` loads `health-model.js` and `physical.js`. Render only inside that panel.
4. Catch section errors inside the panel. Do not write to `#data-error` or the finance nodes.
5. Implement `clear` so sign-out wipes the new panel. Bump `ASSET_VERSION` in `app.js` when a lazy script changes.

Plan language for Physical Progress uses `family-os-plan-lang` (`pt` or `en`, default `pt`). Plan strings are shown as stored.

## Health data contract

`supabase/011_health.sql` is the schema already applied to the private database. Do not run it again from the app. It has no personal rows.

Authenticated reads use the existing supabase-js client and `client.schema('family_api')`:

| View | Access | Notes |
| --- | --- | --- |
| `health_weighins` | select, insert, delete | Insert `measured_on`, `weight_kg`, and optional `time_of_day` (`morning`, `evening`, `other`). Delete by `id`. No update grant. |
| `health_assessments` | select | `method` is `skinfold`, `bioimpedance`, or `smart_scale`. `is_reference` marks the reference reading. `summary`, `measurements`, and `results` are jsonb. Result rows may omit recommendation and status. |
| `health_plans` | select | `data` jsonb holds the plan: author, objective, target, frequency, macros, hydration, supplements, `next_assessment`, tips, and meals. Meal options include `items` (`food_pt`, `food_en`, `amount`, optional `group_pt`) and `notes_pt` / `notes_en`, which may be empty. |

Portuguese plan text is rendered verbatim.

## Checks

```bash
node --check app.js
node --check health-model.js
node --check physical.js
node --test tests/health-model.test.mjs
```

The unit tests use invented demo numbers only.
