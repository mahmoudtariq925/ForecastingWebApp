# Liquid — Treasury Cash Flow Forecasting

A client/server application for weekly treasury cash-flow forecasting across
multiple entities:

- **Client**: React + TypeScript + Vite + Tailwind CSS (`src/`)
- **API**: Node + Express + SQLite (`server/`), with uploaded workbooks in
  `server/uploads/`
- **Shared contracts**: domain types + the Excel template parser (`shared/`),
  used by both sides

All business data — users, forecast templates, template assignments,
submissions, approvals, settings, entities, cycles — lives behind the REST
API. The frontend holds no local data files; every create/read/update/delete
is an API call. See [`PROJECT.md`](./PROJECT.md) for the phased roadmap.

## Run locally

Requires Node 18+ (Node 20 recommended).

```bash
npm install                 # client deps
npm --prefix server install # API deps
npm run dev                 # starts the API (:4000) and Vite (:5173) together
```

The Vite dev/preview server proxies `/api` to `http://localhost:4000`. Other
scripts:

```bash
npm run dev:client        # Vite only
npm run dev:server        # API only (tsx watch)
npm run start:server      # API without watch
npm run build             # type-check + production client build in dist/
npm run preview           # serve the production build (with /api proxy)
npm run typecheck:server  # type-check the API
npm run lint              # ESLint over client + server
```

The API stores its SQLite database in `server/data/liquid.db` and uploaded
template workbooks in `server/uploads/` (both git-ignored, created and seeded
on first boot). Delete them for a factory reset.

## Architecture

```
src/  (React client)                    server/src/  (API)
  api/          fetch client + typed      controllers/   HTTP routing only
                calls per resource        services/      business rules
  components/   screens (unchanged UI)    repositories/  persistence interfaces
  data/         periods, demo seeding,       + SQLite implementations
                submission lifecycle      storage/       FileStorage interface
  hooks/        useApi loader                + local /uploads implementation
  utils/        Excel import/export       db/            schema + demo seed
shared/         domain types + workbook-structure parser (both sides)
```

**Swap points for Azure** (by design, no frontend changes):

- `server/src/repositories/index.ts` — factory returning the SQLite
  implementations of the repository interfaces in `repositories/types.ts`.
  Azure SQL = new implementations, same interfaces.
- `server/src/storage/fileStorage.ts` — `FileStorage` interface with a local
  `/uploads` implementation. Azure Blob Storage = new implementation.
- Client API base URL: `/api` by default (proxied), overridable via
  `VITE_API_URL`.

### REST API

| Resource | Endpoints |
| --- | --- |
| Entities | `GET /api/entities` |
| Users | `GET/POST /api/users`, `PATCH/DELETE /api/users/:email` |
| Cycles | `GET/POST /api/cycles`, `PATCH /api/cycles/:id` |
| Settings | `GET/PUT /api/settings` |
| Templates | `GET/POST /api/templates`, `PATCH/DELETE /api/templates/:id`, `GET/PUT /api/templates/:id/file` |
| Submissions | `GET /api/submissions?period=&entity=`, `GET/PUT /api/submissions/:period/:entity/:templateId` |
| Approvals | `GET /api/approvals/:cycleId`, `PUT /api/approvals/:cycleId/:entity` |
| Variances | `GET /api/variances` |

Template uploads are multipart (`file`, optional `layout`); the server stores
the physical .xlsx in `/uploads`, parses the structure **server-side** with
the shared parser, and creates the database record referencing the file.

## Screens

| Screen | What it does |
| --- | --- |
| **Dashboard** | KPIs computed from API data, live cycle-progress table, outlook chart, real exports |
| **Forecast Cycles** | Cycles with persisted open/close and creation |
| **My Submissions** | Entity + Year/Month/Week + template selectors, dynamic grid in either layout, paste-from-Excel, .xlsx import/export with formulas, variance flags with per-cell commentary, per-week history |
| **Approvals** | Approve/reject queue persisted per cycle |
| **Consolidated** | Treasury read-only view with computed KPIs and XLSX export |
| **Comparisons** | Forecast-vs-forecast tabs fed by API data |
| **Templates** | Upload .xlsx to the server, assign per country, edit / replace / download / remove |
| **User Management** | Add users, assign roles, remove |
| **Settings** | Variance threshold and cycle rules (drive the variance flags) |

### Forecast templates

Templates are ordinary .xlsx files; the **structure is derived from the
workbook server-side** — no naming conventions. Two layouts are supported
(auto-detected on upload, switchable per template):

- **Grouped** (the `samples/CF_Forecast_Template.xlsx` standard): one row per
  working day, a `Date` header column, category columns under group bands,
  Comments / Total / Running total, and a Starting balance.
- **Days across columns**: line items down the first column, one column per
  day; formula rows are treated as computed totals.

### Forecast periods

Forecasts are maintained on a **rolling weekly basis** (Year → Month → Week
filter). Each submission covers a 4-week horizon of 20 working days starting
the selected week's Monday. Variance flags compare each cell date-aligned
against the prior week's submission.

### Excel import/export

Exports produce a real Excel *table* matching the UI layout with live
formulas (day totals, running balance, SUMIF inflows/outflows, net, closing
balance). Imports auto-detect the file's orientation, match categories by
label, align grouped files by date, and pick up per-day comments and the
starting balance.
