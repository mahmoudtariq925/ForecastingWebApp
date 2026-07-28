# Liquid — Treasury Cash Flow Forecasting

A React + TypeScript + Vite + Tailwind CSS application for weekly treasury
cash-flow forecasting across multiple entities. This is **Phase 1**: a fully
interactive frontend backed by browser `localStorage`. See
[`PROJECT.md`](./PROJECT.md) for the phased roadmap (Azure backend + SSO come
later).


## Screens

| Screen | What it does |
| --- | --- |
| **Dashboard** | Computed KPIs, live cycle-progress table (all entities), 4-week outlook chart from the live consolidated data, Outlook chaser emails, real data export (xlsx/csv/json) |
| **Forecast Cycles** | Weekly cycles with persisted open/close and real cycle creation |
| **My Submissions** | Template + period (month/year) + entity selectors, dynamic grid with a **dates-across ⇄ dates-down orientation toggle**, live running-balance chart (selectable series & line styles), paste-from-Excel, .xlsx import/export, "Email Approver" Outlook draft, variance flags with per-cell commentary, per-period history |
| **Approvals** | Approve/reject queue persisted against the active cycle and onto the stored submission, with live flag counts and a deep link into the forecast |
| **Consolidated** | Treasury read-only cell-wise sum of every entity's submission, computed KPIs, real XLSX export, Outlook summary email |
| **Comparisons** | Forecast-vs-forecast on the **same live submission data**: daily chart (metric selector), by-entity and by-category tabs, computed largest-variances table, week-pair selector |
| **Comments Review** | Treasury triage of variance commentary across all forecasts: summary KPIs, search + entity/period/status/submitter/state filters, collapsible per-forecast groups, pagination, per-comment and per-forecast resolution, deep link into the submission |
| **Templates** | Two authoring routes to the same structure: **build one in the browser** with the spreadsheet-style Template Builder (rows = sections / line items / computed subtotals, columns = forecast periods, editable starting values, live preview) or **upload an .xlsx** (structure & orientation auto-detected). Assign to countries, reopen and keep editing, replace / download / remove |
| **Legal Entity Setup** | Entity-first configuration: entity master data (country, region, currency, status), the users responsible for it (viewers / approvers / submitters, each selectable only from users holding that global role) and its forecast template |
| **User Management** | Add / edit / activate / deactivate / remove users and set their **global role** (Treasury / Approver / Submitter / Viewer), with a read-only Responsibilities column derived from Legal Entity Setup, plus a prefilled Outlook setup email per user |
| **Settings** | Forecast horizon and cycle frequency, variance threshold rules, and the SSO / allowed-domain configuration |

### Forecast templates

Templates are ordinary .xlsx files parsed in the browser ([exceljs](https://github.com/exceljs/exceljs)).
**The structure is derived from the workbook itself** — there are no naming
conventions to follow. Two workbook layouts are auto-detected on upload; the
on-screen orientation is a **display option toggled on the Submission screen**
(dates across the columns or dates down the rows), independent of how the
uploaded file was laid out and without touching the stored values:

- **Grouped** (the default `samples/CF_Forecast_Template.xlsx` standard): one
  row per working day, a `Date` header column followed by category columns,
  group bands (e.g. *Trade AR & AP*, *Taxes*, *Payroll*, *IC Settlements*) on
  the row above the headers, plus Comments / Total / Running total columns and
  a Starting balance cell.
- **Days across columns**: line items down the first column, one column per
  day. Rows containing formulas are treated as computed totals and recreated
  by the app; label-only rows become group headers.

The built-in default template mirrors the standard treasury workbook
(Receivables, Payables, Corporate Income, Other Taxes, Salaries, Social
Securities, CAPEX, IC Settlements, Other) with a per-submission **starting
balance** and running-balance calculation. Sign convention: inflows positive,
outflows negative.

### Building a template in the browser

Templates no longer have to come from Excel. **Templates → + Create Template**
opens a spreadsheet-style builder where the grid *is* the template:

- **Rows** are the forecast structure — each row is a *section* band, an
  input *line item*, or a computed *subtotal* (which sums the line items
  above it inside its section and is never typed into). Rows can be renamed
  inline, retyped between the three kinds, reordered, inserted (Enter adds a
  row below and focuses it) and deleted.
- **Columns** are the forecast periods: add or remove individual columns, or
  set a count and granularity (working days / weeks / months). Templates
  without a period block — every uploaded workbook and the seeded standard
  one — keep the classic 4-week, 20-working-day horizon, so existing
  forecasts are unaffected.
- **Cells** hold optional starting values that new submissions are seeded
  with.
- **Preview** renders the real forecast grid, read-only, exactly as
  submitters will see it, then **Save Template** stores it. Any template can
  be reopened later with **Edit Structure** and editing continued.

Both routes produce the same `ForecastTemplate` — the same
`categories` / `layout` contract — so an editor-built template is
interchangeable with an uploaded one everywhere: entity assignment,
submission entry, variance flags, Excel export and the comparison screens.

### Forecast periods

Forecasts are maintained on a **rolling weekly basis**. The period filter is
Year → Month → Week; each submission covers a 4-week horizon of 20 working
days starting on the selected week's Monday (weekends are skipped, like the
standard workbook's `WORKDAY()` sequence). Variance flags compare each cell
against the same calendar date in the prior week's stored submission.

### Excel import/export

- **Export** produces a real Excel *table* matching the UI layout, with live
  formulas: per-day `Total` and `Running total`, `Total Inflows` / `Total
  Outflows` (`SUMIF`), `Net Cash Flow` and `Closing Balance`, plus a native
  totals row.
- **Import** auto-detects the file's orientation, matches categories by
  label, aligns grouped files by date, and picks up per-day comments and the
  starting balance.

Which template an entity submits on is set **only** in Legal Entity Setup —
the Templates screen reports it in a read-only *Used By* column but never
assigns it, so there is exactly one place to change it. Each (entity, week,
template) combination is stored separately, so previous weeks stay editable
without affecting current ones.

The forecast screen also offers **Export Template**, which downloads the
current template as a blank workbook to fill in offline.

### Entering numbers

Cells hold the text you type while you're typing it and commit the parsed
number alongside — binding the input straight to a number meant "-" and "1."
were parsed away mid-keystroke, so `-500` stored `500` and `1.5` stored `15`.

One parser (`parseCellNumber` in `gridMath.ts`) handles typing, pasting and
the starting balance, so anything Excel produces lands correctly: accounting
negatives `(500)`, currency prefixes `£900` / `€ 250`, thousands separators
(comma, space, non-breaking space), European decimal commas `1.234,56`,
trailing-minus `500-` and the Unicode minus Excel emits. Text that isn't a
number (a header caught inside a copied range) is skipped rather than
written as a zero, and a paste that skips anything says so instead of
silently dropping cells.

**Starting balance is optional.** Leave it blank and the grid drops the
running-total column (and the days-across *Closing Balance* row) entirely
rather than counting up from an assumed zero; type a value and the column
appears immediately. Demo forecasts open with a seeded balance, so they look
unchanged; a real one starts blank until the submitter fills it in.

**Undo/redo** covers the whole forecast — `Ctrl+Z` / `Ctrl+Shift+Z` (or
`Ctrl+Y`), plus toolbar buttons. One step undoes a whole pasted block or a
Reset, not just a keystroke; a run of typing in one cell is a single step.
Free-text commentary boxes keep the browser's own undo.

### Global roles vs. entity responsibilities

Two deliberately separate concepts:

| | Answers | Configured in |
| --- | --- | --- |
| **Global role** | *What* may this user do? | User Management |
| **Entity responsibility** | *Where* may they do it? | Legal Entity Setup |

Nothing about entity assignment is stored on the user object. A legal entity
owns its own `viewers` / `approvers` / `submitters` lists plus its forecast
template, and User Management renders a **read-only Responsibilities column**
derived live from them — remove someone as an approver for Germany in Legal
Entity Setup and Germany disappears from their responsibilities immediately.

The four global roles:

- **Treasury** — the complete experience: the Treasury Manager workflow
  (Dashboard with the *Requires Attention* list and Region → Country
  drill-down, forecast cycles, submissions, approvals, consolidated,
  comparisons, comment review) **and** full management of the configuration
  screens (User Management, Templates, Legal Entity Setup, Settings). The
  separate Administrator role was merged into Treasury, so there is one
  role that owns the system rather than two overlapping ones. Default
  session on a fresh browser; users stored under the old `admin` role are
  migrated to Treasury on load.
- **Approver** — reviews, approves and returns forecasts for assigned
  entities; scoped approval queue.
- **Submitter** — edits, comments on and submits forecasts for assigned
  entities.
- **Viewer** — read-only forecast access for assigned entities: the grid
  renders without inputs, and Save/Submit/Reset are all absent.

Approvers, submitters and viewers never see Users, Settings or Legal Entity
Setup, and only ever the entities assigned to them.

### Where the logic lives

`src/data/session.ts` is the single source of role logic: `currentUser()`,
`permissionsFor(user)` — a flat capability map (`canManageUsers`,
`canManageSettings`, `canManageLegalEntities`, `canSubmitForecasts`,
`canViewForecasts`, `canViewAllEntities`, …) —
and `assignedEntitiesFor(user)`. `src/data/legalEntityService.ts` owns the
entity↔user relationships (`responsibilitiesFor`, `eligibleUsers`,
`withAssignment`). Navigation and the screen guard derive from permissions
(`navFor` / `allowedViews` / `landingViewFor` in `src/types/nav.ts`), so
components never hardcode role checks and Phase 3 can swap in the Azure AD
identity plus backend authorization in one place.

The sidebar user card doubles as a **dev-only user switcher** (click it to
pick any seeded user) to preview each experience; the selection persists
locally.

### One source of truth

Every screen that shows forecast numbers (Dashboard KPIs and outlook chart,
Consolidated, Comparisons, Comments Review, the Export modal) derives them
from the same stored submissions the Submission screen edits, via
`src/data/submissionService.ts` (entities without a stored submission fall
back to deterministic demo data). Change a cell in My Submissions and the
consolidated totals, comparison tabs, variance tables and charts all follow.

### Guided walkthrough (onboarding)

New users are shown a short, role-aware product tour the first time they sign
in. **Every screen in a role's navigation gets at least one step**: a Submitter
is walked through entering numbers and submitting, an Approver through the
queue and the approve/reject decision, a Viewer through filtering and
exporting, and Treasury through the whole thing — dashboard, forecast cycles,
submissions, approvals, consolidation, comparisons, comment triage, then the
configuration screens (templates, Legal Entity Setup, users, settings) it
absorbed with the Administrator role.

The tour navigates between screens itself, **highlights the destination page in
the sidebar** so it's clear where it took you, and **scrolls each target into
view** before showing its popup, so a step near the bottom of a long page is
never left below the fold.

- **Library:** [driver.js](https://driverjs.com) (~5 KB gzipped, zero
  dependencies, TypeScript types, plain CSS selectors). Chosen over Shepherd.js
  (larger, pulls in Floating UI) and reactour (React-portal based, heavier and
  more opinionated about markup) because the highlighting is selector-driven,
  which lets every step target a stable `data-tour` attribute instead of a
  component. Nothing about the tour leaks into the screens themselves.
- **All content lives in `src/onboarding/tourSteps.ts`** — one array per role,
  each step a `{ selector, title, body, view, side }` object. Adding,
  reordering or rewording a step is a change to that file only.
- **`src/onboarding/useOnboardingTour.ts`** is the engine: it switches screens
  between steps, marks the destination in the nav, waits for React to render
  the target, scrolls it into view, and **skips any step whose element isn't
  there** (a hidden feature, a role variation, a narrow screen) rather than
  breaking the sequence. Steps on a screen the user can't open are dropped
  instantly rather than navigating and waiting for an element that will
  never appear.
- **When it runs:** automatically on a user's first sign-in (tracked per email
  under `liquid:onboarding:seen:<email>`), or when an invite link carries
  `?welcome=1` — the invite emails sent from User Management include it.
  Afterwards it's available on demand from **your name → Replay walkthrough**.
- **Trying each role:** the user switcher lists four demo joiners under
  *New joiners · runs the tour* (Nina Brandt – Submitter, Omar Haddad –
  Approver, Priya Raman – Viewer, Rasmus Nilsen – Treasury). Picking one
  starts that role's walkthrough; picking the one you're already signed in
  as replays it.

### Email actions (frontend-only)

Buttons like **Email Approver**, **Send Chaser**, **Email Summary** and the
User Management setup emails open the user's desktop mail client (Outlook)
through prefilled `mailto:` drafts — recipients resolved from the managed
user list, subject and body prepopulated from the live data. Nothing is sent
by the app itself and there is no backend involved.

The app is responsive: below ~900px the sidebar becomes a drawer and wide
tables scroll inside their panels.

### Zoom and short viewports

The sidebar is laid out so its two corners are always reachable: the brand is
pinned to the top, the user card (and its menu) to the bottom, and only the
nav list between them scrolls. The sidebar column is sized in relative units
(`clamp`) rather than a fixed 240px, and the app's grid row is explicitly
constrained so a tall sidebar scrolls inside the viewport instead of growing
past it. Verified at 80 / 90 / 110 / 125 / 150% browser zoom: the user menu
opens fully on screen and nothing critical is clipped or pushed off-screen.

## Run locally

Requires Node 20+ (Node 24 LTS recommended — what CI builds with).

```bash
npm install      # install dependencies
npm run dev      # start the Vite dev server (http://localhost:5173)
```

Other scripts:

```bash
npm run build    # type-check and produce a production build in dist/
npm run preview  # serve the production build locally
npm run lint     # run ESLint
```

## Preview on GitHub Pages

Every push to `main` triggers `.github/workflows/deploy.yml`, which runs
`npm run build` and publishes `dist/` to the **`gh-pages`** branch via
[`peaceiris/actions-gh-pages`](https://github.com/peaceiris/actions-gh-pages).

One-time setup in the GitHub repo:

1. Push this project to `main`.
2. In **Settings -> Pages**, set **Source** to *Deploy from a branch* and pick
   the **`gh-pages`** branch (root). The first workflow run creates it.
3. The site is served at
   `https://<your-user>.github.io/<repo>/` — e.g.
   `https://mahmoudtariq925.github.io/ForecastingWebApp/`.

`vite.config.ts` sets `base: './'` so assets resolve correctly from the
project subpath.

## The two instances: static demo vs live

One codebase, two deployable builds, switched at **build time** by
`VITE_DATA_SOURCE` (see `src/data/dataSource.ts`):

| | **static** (default) | **live** |
|---|---|---|
| Data | Seeded demo entities, users, numbers | Starts empty — populated by you |
| Users | Demo people + demo joiners | One bootstrap admin (`VITE_ADMIN_NAME` / `VITE_ADMIN_EMAIL`), then whoever you create |
| Entities | 11 demo countries | Whatever you add in Legal Entity Setup |
| Numbers | Deterministic demo values | Imported workbooks only — the app never invents a number |
| Extra screens | — | **Data Import** (setup checklist + .xlsx/.csv upload) |
| Badge | — | `LIVE` pill in the sidebar |
| Storage namespace | `liquid:*` | `liquid-live:*` (the two can never mix, even on one origin) |
| Build | `npm run build` → `dist/` | `npm run build:live` → `dist-live/` (loads `.env.live`) |
| Deploy | `deploy.yml` (auto on push to `main`) → Pages **root** | `deploy-live.yml` (**manual** workflow_dispatch) → Pages **/live/** |
| URL | `…github.io/ForecastingWebApp/` | `…github.io/ForecastingWebApp/live/` |

The two workflows share one concurrency group and both set `keep_files`, so
each writes only its own folder: pushing code redeploys the demo but never
the live instance; running the live deploy never touches the demo. All
screens read seed/reference data through `src/data/appData.ts` — the single
data access layer that switches on the mode — so when the Phase 2 backend
arrives it attaches to the live build by swapping that file (and the storage
layer) for API calls.

**Setting up the live instance** (first visit, as the bootstrap admin):
open **Data Import** and follow the checklist — add legal entities, create
users, assign responsibilities in Legal Entity Setup, then upload one
Excel/CSV workbook per entity and week. Files go through the exact importer
My Submissions uses: layout auto-detected, line items matched by label,
`1,234` / `(500)` CSV number formats understood. Imported forecasts drive
the dashboard, consolidation, comparisons and reviews immediately.

Environment variables (all build-time, all public — never put secrets in
`VITE_` vars): `VITE_DATA_SOURCE` (`static`/`live`), `VITE_ADMIN_NAME`,
`VITE_ADMIN_EMAIL` — defined in `.env.live`, read only by `--mode live`.

## Project structure

```
src/
  components/
    layout/        Sidebar, TopBar
    dashboard/     Dashboard screen
    cycles/        Forecast Cycles screen
    submissions/   Submission editor + ForecastGrid + gridMath
    approvals/     Approvals screen
    consolidated/  Treasury consolidated (read-only) view
    comparisons/   Forecast vs forecast
    review/        Comments Review (treasury comment triage)
    templates/     Forecast template upload / assignment management
    users/         User management
    settings/      Settings screen (+ defaults)
    common/        Modal, StatusPill, Chart (data-driven SVG), icons, AppModals
  onboarding/
    tourSteps.ts   Role-aware walkthrough content (the only file to edit)
    useOnboardingTour.ts  Tour engine: screen changes, waiting, graceful skips
    dataImport/    Data Import screen (live instance: checklist + upload)
  data/
    dataSource.ts  Build-time static|live switch (VITE_DATA_SOURCE)
    appData.ts     Data access layer: entities/cycles/users per data source
    mockData.ts    Seed data, the standard template, demo-value generation
    periods.ts     Reporting periods (month/year) and day labels
    session.ts     The signed-in user + permissions (until Phase 3 SSO)
    submissionService.ts  Submissions, consolidation, variances, review groups
  storage/
    localStorage.ts  saveData()/loadData() + named helpers (saveSubmission, ...)
  types/
    index.ts       Domain types (Cycle, Submission, ForecastTemplate, User, ...)
    nav.ts         View / modal identifiers and nav config
  utils/
    excel.ts       .xlsx parse/import/export (exceljs, lazily loaded)
    email.ts       mailto: helpers (Outlook drafts, recipient resolution)
    download.ts    Blob download + base64 file helpers
  App.tsx          Shell: navigation + active screen + shared modals
  main.tsx         Entry point
  index.css        Design system (ported verbatim from the prototype) + responsive rules
```

## Persistence

All reads and writes go through `src/storage/localStorage.ts`. It persists:

- submissions per period/entity/template (`saveSubmission` / `loadSubmission` / `listSubmissions`)
- forecast templates incl. the uploaded .xlsx (`saveTemplates` / `loadTemplates`)
- approval statuses (`saveApprovals` / `loadApprovals`)
- cycle statuses (`saveCycles` / `saveCycle`)
- user roles (`saveUsers` / `loadUsers`)
- settings (`saveSettings` / `loadSettings`)
- whether each user has seen the walkthrough (`onboarding:seen:<email>`)

Data loads on app start and saves on every change. Because no component talks
to `localStorage` directly, swapping to a real API in Phase 2 is a change to
this one file.
