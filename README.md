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
| **Comments Review** | Admin triage of variance commentary across all forecasts: summary KPIs, search + entity/period/status/submitter/state filters, collapsible per-forecast groups, pagination, per-comment and per-forecast resolution, deep link into the submission |
| **Templates** | Two authoring routes to the same structure: **build one in the browser** with the spreadsheet-style Template Builder (rows = sections / line items / computed subtotals, columns = forecast periods, editable starting values, live preview) or **upload an .xlsx** (structure & orientation auto-detected). Assign to countries, reopen and keep editing, replace / download / remove |
| **Legal Entity Setup** | Entity-first configuration: entity master data (country, region, currency, status), the users responsible for it (viewers / approvers / submitters, each selectable only from users holding that global role) and its forecast template |
| **User Management** | Add / edit / activate / deactivate / remove users and set their **global role** (Admin / Treasury / Approver / Submitter / Viewer), with a read-only Responsibilities column derived from Legal Entity Setup, plus a prefilled Outlook setup email per user |
| **Settings** | Variance threshold, cycle rules, and the "Allow Treasury users to manage users and settings" delegation toggle (admin-only) |

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

Admins assign each template to one or more countries in the Templates screen;
submitters then pick from their assigned templates in My Submissions. Each
(entity, week, template) combination is stored separately, so previous
weeks stay editable without affecting current ones.

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

The five global roles:

- **Admin** — system configuration only: User Management, Templates, Legal
  Entity Setup and Settings. No dashboard or forecast workflow.
- **Treasury** — the full Treasury Manager experience (Dashboard with the
  *Requires Attention* list and Region → Country drill-down, submissions,
  approvals, consolidated, comparisons, comment review) plus **view** access
  to the configuration screens. Whether Treasury may *modify* those is
  governed by the Settings toggle below. Default session on a fresh browser.
- **Approver** — reviews, approves and returns forecasts for assigned
  entities; scoped approval queue.
- **Submitter** — edits, comments on and submits forecasts for assigned
  entities.
- **Viewer** — read-only forecast access for assigned entities: the grid
  renders without inputs, and Save/Submit/Import/Reset are all absent.

Approvers, submitters and viewers never see Users, Settings or Legal Entity
Setup, and only ever the entities assigned to them.

### Treasury management toggle

Settings → *Access & Delegation* → **"Allow Treasury users to manage users and
settings"**, off by default. While off, Treasury can view User Management,
Settings and Legal Entity Setup but every control is disabled and a
**View Only** badge is shown. Turning it on grants Treasury management of all
three. Only an admin can change the toggle; Treasury sees it disabled.

### Where the logic lives

`src/data/session.ts` is the single source of role logic: `currentUser()`,
`permissionsFor(user)` — a flat capability map (`canManageUsers`,
`canManageSettings`, `canManageLegalEntities`, `canSubmitForecasts`,
`canViewForecasts`, `canViewAllEntities`, `canChangeTreasuryToggle`, …) —
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

### Email actions (frontend-only)

Buttons like **Email Approver**, **Send Chaser**, **Email Summary** and the
User Management setup emails open the user's desktop mail client (Outlook)
through prefilled `mailto:` drafts — recipients resolved from the managed
user list, subject and body prepopulated from the live data. Nothing is sent
by the app itself and there is no backend involved.

The app is responsive: below ~900px the sidebar becomes a drawer and wide
tables scroll inside their panels.

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
    review/        Comments Review (admin comment triage)
    templates/     Forecast template upload / assignment management
    users/         User management
    settings/      Settings screen (+ defaults)
    common/        Modal, StatusPill, Chart (data-driven SVG), icons, AppModals
  data/
    mockData.ts    Seed data, the standard template, demo-value generation
    periods.ts     Reporting periods (month/year) and day labels
    session.ts     The signed-in user (seeded admin until Phase 3 SSO)
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

Data loads on app start and saves on every change. Because no component talks
to `localStorage` directly, swapping to a real API in Phase 2 is a change to
this one file.
