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
| **Templates** | Upload .xlsx forecast templates (structure & orientation auto-detected), assign them to countries, edit / replace / download / remove |
| **User Management** | Add users, assign roles (Treasury / Approver / Submitter / Admin), remove — all persisted — plus a prefilled Outlook setup email per user |
| **Settings** | Variance threshold and cycle rules (drive the submission variance flags) |

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

### Roles &amp; the two experiences

The app renders one of two experiences from the mock session (no real
authentication yet — Phase 3 swaps this for Azure AD):

- **Admin / Treasury** (`admin`, `treasury`): the full Treasury Manager
  experience — Treasury Dashboard landing page (KPIs, a live *Requires
  Attention* list covering missing submissions, forecasts awaiting approval,
  unresolved comments and material week-over-week movements, plus a
  Region → Country cycle-progress drill-down), all submissions, consolidated
  and comparison views, approvals, comment review and every admin screen.
- **End user / Analyst** (`submitter`, `approver`): a focused workspace —
  *My Dashboard* landing page (welcome, current cycle and deadline, forecast
  week, assigned entities, needs-my-action count, per-forecast status with
  one-click **Open / Continue Forecast**, Treasury feedback, recent
  activity), *My Forecasts* scoped to their assigned entities and a
  read-only *Comments / Feedback* view (approvers additionally get their
  scoped approval queue). No treasury-wide data, admin screens or other
  entities are reachable.

Role logic is centralised in `src/data/session.ts`: `currentUser()`,
`permissionsFor(user)` (a flat capability map: `canViewTreasuryDashboard`,
`canManageUsers`, `canSubmitForecasts`, …) and `assignedEntitiesFor(user)`.
Navigation and the screen guard both derive from it (`navFor` /
`allowedViews` / `landingViewFor` in `src/types/nav.ts`) — components never
hardcode role checks. The sidebar user card doubles as a **dev-only user
switcher** to preview each experience; the selection persists locally.

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
