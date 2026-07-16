# Liquid — Treasury Cash Flow Forecasting

A client/server application for weekly treasury cash-flow forecasting across
multiple entities:

- **Client**: React + TypeScript + Vite + Tailwind CSS (`src/`)
- **API**: Node + Express (`server/`), organised as Azure Function-style
  handlers → services → repositories → a pluggable storage provider (local
  files by default, mirroring Azure Blob Storage)
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

By default the API persists to `server/storage/` (JSON documents + uploaded
workbooks; git-ignored, created and seeded on first boot). Delete that folder
for a factory reset. Set `STORAGE_PROVIDER=sqlite` to persist to
`server/data/liquid.db` instead — same behaviour, different backend.

## Architecture

The backend mirrors the planned Azure production layering. Each arrow is an
interface boundary:

```
React frontend → REST API → Handlers → Services → Repositories → StorageProvider → (Local files / SQLite / Azure Blob)
```

```
src/  (React client)              server/src/  (API)
  api/        fetch client +        http/          neutral HttpRequest/Result, route table,
              typed calls                          Express adapter (only framework binding)
  components/ screens (UI)          handlers/      Azure Function-style handlers (minimal HTTP)
  data/       periods, demo         services/      ALL business rules (async)
              seeding, submission   repositories/  storage-agnostic persistence (JSON collections)
  hooks/      useApi loader         storage/       StorageProvider interface +
  utils/      Excel import/export                   LocalStorageProvider, SqliteStorageProvider,
shared/       domain types +                        FileStorage façade
              workbook parser       seed.ts        demo dataset (via repositories)
```

- **Handlers** are isolated `(HttpRequest) => Promise<HttpResult>` functions
  with no framework types — each could be dropped into an Azure Function. The
  Express adapter (`http/expressAdapter.ts`) is the only web-framework-coupled
  file; it consumes a neutral route table (`http/routes.ts`).
- **Services** hold every business rule (validation, duplicate/conflict
  checks, status transitions). Handlers and repositories contain none.
- **Repositories** depend only on the `StorageProvider` interface — no SQL, no
  filesystem, no vendor concepts. They manage JSON collections/documents.
- **StorageProvider** models storage like Azure Blob: named collections
  holding JSON documents and binary blobs.

**Swap points for Azure** (by design — no frontend, service, repository or API
changes):

- `server/src/storage/index.ts` — provider factory. Add an
  `AzureBlobStorageProvider` implementing `StorageProvider` and return it for
  `STORAGE_PROVIDER=azure-blob`. Repositories and `FileStorage` then use Blob
  automatically.
- `server/src/http/` — the Express adapter + route table. Azure Functions =
  an equivalent adapter reusing the same handlers.
- Client API base URL: `/api` by default (proxied), overridable via
  `VITE_API_URL`.

### Storage providers

`STORAGE_PROVIDER` selects the backend (default `local`):

- **`local`** — `LocalStorageProvider`, a folder that mirrors Azure Blob:
  ```
  server/storage/
    users/users.json          entities/entities.json     cycles/cycles.json
    settings/settings.json     submissions/submissions.json
    approvals/approvals.json   variances/variances.json
    templates/templates.json   templates/uploads/<templateId>.xlsx
  ```
- **`sqlite`** — `SqliteStorageProvider`, the same interface backed by a
  `documents` (JSON) + `blobs` table. Proves the abstraction; run with
  `STORAGE_PROVIDER=sqlite npm run start:server`.
- **`azure-blob`** — production target; implement `AzureBlobStorageProvider`.

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
the physical .xlsx via `FileStorage` (a blob in the active storage provider),
parses the structure **server-side** with the shared parser, and creates the
persistence record referencing the file. URLs, request and response models are
identical across storage providers.

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
