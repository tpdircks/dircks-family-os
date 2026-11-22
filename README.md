# Dircks Family OS

Private static dashboard. Finances stay the default view. Calendar, Elite Mindset Book, and Physical Progress are additional tabs. Each tab reads `family_api` only after an approved sign-in. This repository is public: do not commit weights, measurements, meal contents, calendar entries, outreach rows, or other personal records. Those values load at runtime.

## Tabs

Tabs are one list in `app.js`:

```js
const TABS = [
  { id: 'finances', label: 'Finances', load: loadFinances, clear: clearFinances },
  { id: 'calendar', label: 'Calendar', load: loadCalendarTab, clear: clearCalendarTab },
  { id: 'book', label: 'Elite Mindset Book', load: loadBookTab, clear: clearBookTab },
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

## Calendar and Elite Mindset Book

`supabase/012_calendar_book.sql` is the schema already applied to the private database. Do not run it again from the app. It has no personal rows. The browser reads `family_api` with the signed-in supabase-js client and does not insert. Bots write with the service role, or with SQL as the table owner. Never put the service role key in this repo or in the browser.

| Object | Who can write | Notes |
| --- | --- | --- |
| `family_api.calendar_events` | service role | Read-only for the signed-in dashboard. |
| `family_api.book_outreach` | service role | Same. `stage` is one of `found`, `drafted`, `pending_approval`, `sent`, `replied`, `booked`, `skipped`. |
| `family_api.calendar_conflicts(starts_at, ends_at, exclude_id)` | service role and the signed-in owner | Returns overlapping rows whose status is not `cancelled`. |

`ends_at` is exclusive. A block that ends at 10:00 does not overlap a block that starts at 10:00. Cancelled rows are ignored by the conflict check and hidden in the dashboard. Overlaps are still allowed so a bot can record them. The calendar tab marks every non-cancelled overlap.

### Time zones

`starts_at` and `ends_at` are absolute instants. `tz` is the IANA name the event was scheduled in, such as `America/Belem` or `America/Denver`. The dashboard shows that zone, and also Troy's current zone when the names differ.

Troy's current zone is `America/Belem` until 2026-12-14 00:00 in Belem (`2026-12-14T03:00:00Z`), then `America/Denver`.

All-day events use local midnights in `tz`: `all_day = true`, `starts_at` at the first day's midnight, `ends_at` at the midnight after the last day. A one-day event on December 1 in Belem ends at December 2 00:00 in Belem, not at 23:59.

Build an instant in a zone with `timestamp at time zone`:

```sql
select '2026-12-01 09:00:00'::timestamp at time zone 'America/Belem';
```

### Add an event

Check first, then insert. This sample is fake and is not seeded by the migration.

```sql
select *
from family_api.calendar_conflicts(
  '2026-12-01 09:00:00'::timestamp at time zone 'America/Belem',
  '2026-12-01 10:00:00'::timestamp at time zone 'America/Belem',
  null
);

insert into family_private.calendar_events
  (title, starts_at, ends_at, tz, all_day, category, source, status)
values (
  'Example planning block',
  '2026-12-01 09:00:00'::timestamp at time zone 'America/Belem',
  '2026-12-01 10:00:00'::timestamp at time zone 'America/Belem',
  'America/Belem',
  false,
  'planning',
  'example-bot',
  'tentative'
);
```

From a bot using the service role:

```js
const start = '2026-12-01T12:00:00.000Z';
const end = '2026-12-01T13:00:00.000Z';
const { data: conflicts, error: conflictError } = await supabase
  .schema('family_api')
  .rpc('calendar_conflicts', { starts_at: start, ends_at: end, exclude_id: null });

const { error } = await supabase.schema('family_api').from('calendar_events').insert({
  title: 'Example planning block',
  starts_at: start,
  ends_at: end,
  tz: 'America/Belem',
  all_day: false,
  category: 'planning',
  source: 'example-bot',
  status: 'tentative'
});
```

`category` is stored lowercase. `podcast` and `interview` are what the Elite Mindset Book tab lists as booked appearances. `source` is the bot or person that added the row. `status` is `tentative`, `confirmed`, or `cancelled`. `link` must start with `https://`.

Pass the row id as `exclude_id` when you are moving an existing event and do not want it to conflict with itself.

Read events the same way the dashboard does:

```js
const { data, error } = await supabase
  .schema('family_api')
  .from('calendar_events')
  .select('id,title,starts_at,ends_at,tz,all_day,category,source,location,link,notes,status,created_at,updated_at')
  .order('starts_at', { ascending: true });
```

### Outreach rows

Ids look like `EM-2026-11-15-01`. The loader that fills this table is separate. Do not commit real rows.

```sql
insert into family_private.book_outreach
  (id, date_found, place, url, language, stage, raw_status, posted_date, notes)
values (
  'EM-2026-11-15-01',
  '2026-11-15',
  'Example Studio',
  'https://example.com/demo-show',
  'English',
  'found',
  'new lead',
  null,
  'Example only. Not a real pitch.'
);
```

`stage` is normalized on write (`Pending Approval` becomes `pending_approval`). `raw_status` keeps the original words. `updated_at` is set by the database on insert and update.

## Checks

```bash
node --check app.js
node --check health-model.js
node --check physical.js
node --check calendar-model.js
node --check calendar.js
node --check book-model.js
node --check book.js
node --test tests/health-model.test.mjs tests/calendar-model.test.mjs tests/book-model.test.mjs
```

The unit tests use invented demo numbers only.
