# Liquid — Treasury Cash Flow Forecasting

A React + TypeScript + Vite + Tailwind CSS application for weekly treasury
cash-flow forecasting across multiple entities. This is **Phase 1**: a fully
interactive frontend backed by browser `localStorage`. See
[`PROJECT.md`](./PROJECT.md) for the phased roadmap (Azure backend + SSO come
later).

The UI is a faithful build of the original single-file prototype
(`cashflow-app (5).html`) — same colours, fonts (Fraunces / Inter Tight /
JetBrains Mono), spacing and layout, now componentised.

## Screens

| Screen | What it does |
| --- | --- |
| **Dashboard** | KPIs, cycle-progress table (Send Chaser), 30-day outlook chart |
| **Forecast Cycles** | Weekly cycles with status and open/close actions |
| **My Submissions** | 30-day entry grid with paste-from-Excel, variance flags, commentary modal |
| **Approvals** | Approve/reject queue with variance-flag counts |
| **Consolidated** | Treasury read-only view across all entities |
| **Comparisons** | Forecast-vs-forecast with variance drill-down |
| **User Management** | Assign roles (Treasury / Approver / Submitter / Admin) per entity |
| **Settings** | Variance threshold and cycle rules |

## Run locally

Requires Node 18+ (Node 20 recommended).

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
    submissions/   Submission grid (30-day, paste-from-Excel) + ForecastGrid
    approvals/     Approvals screen
    consolidated/  Treasury consolidated (read-only) view
    comparisons/   Forecast vs forecast
    users/         User management
    settings/      Settings screen
    common/        Modal, StatusPill, Chart, icons, AppModals
  data/
    mockData.ts    All dummy data + grid generation helpers in one place
  storage/
    localStorage.ts  saveData()/loadData() + named helpers (saveSubmission, ...)
  types/
    index.ts       Domain types (Cycle, Submission, User, Entity, ...)
    nav.ts         View / modal identifiers and nav config
  App.tsx          Shell: navigation + active screen + modals
  main.tsx         Entry point
  index.css        Design system (ported verbatim from the prototype)
```

## Persistence

All reads and writes go through `src/storage/localStorage.ts`. It persists:

- submissions per cycle/entity (`saveSubmission` / `loadSubmission`)
- approval statuses (`saveApprovals` / `loadApprovals`)
- cycle statuses (`saveCycles` / `saveCycle`)
- user roles (`saveUsers` / `loadUsers`)
- settings (`saveSettings` / `loadSettings`)

Data loads on app start and saves on every change. Because no component talks
to `localStorage` directly, swapping to a real API in Phase 2 is a change to
this one file.
