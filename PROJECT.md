# Project Roadmap — Liquid Cash Flow Forecasting

This document captures where the project is today and how it is intended to
evolve. The architecture is deliberately staged so each phase is an additive,
low-risk step.

## Phase 1 — React frontend + localStorage (done)

The original single-file prototype rebuilt as a React + TypeScript + Vite +
Tailwind app with all screens interactive and persistence in browser
`localStorage`. Superseded by Phase 2.

## Phase 2 — Client/server architecture (current)

**Status: built** — aligned with the target Azure architecture, using local
files (default) or SQLite as stand-ins for Azure Blob Storage.

Target layering, implemented locally end to end:

```
React frontend → REST API → Handlers → Services → Repositories → StorageProvider → Azure Blob Storage
```

- **Express API** (`server/`) exposing REST endpoints for all business data:
  users, forecast templates, template assignments, submissions, approvals,
  settings, entities, cycles, variances. The frontend communicates only
  through API calls — no local data files, nothing in localStorage.
- **Azure Function-style handlers** (`server/src/handlers/`): each endpoint is
  an isolated `(HttpRequest) => Promise<HttpResult>` with no framework types,
  ready to drop into an Azure Function. A neutral route table
  (`http/routes.ts`) plus a thin Express adapter (`http/expressAdapter.ts`) —
  the only web-framework-coupled file — bind them to HTTP.
- **Services** hold every business rule; **repositories** do persistence only;
  handlers do request/response shaping only.
- **StorageProvider abstraction** (`server/src/storage/`): repositories depend
  only on this interface (JSON documents + binary blobs, modelled on Blob
  Storage). `LocalStorageProvider` (default) mirrors Blob with a `storage/`
  folder; `SqliteStorageProvider` is a second implementation of the same
  interface, proving repositories are storage-agnostic. `FileStorage` is a
  generalized façade over the provider's blobs for uploaded workbooks.
- **Shared contracts** (`shared/types.ts`, `shared/excelTemplate.ts`) typed
  against by both sides; template structure is parsed server-side.

### Moving to Azure (the point of this phase's design)

| Local stand-in | Azure production | Change required |
| --- | --- | --- |
| `LocalStorageProvider` / `SqliteStorageProvider` | Azure Blob Storage | New `AzureBlobStorageProvider` (same `StorageProvider` interface); return it from `storage/index.ts` for `STORAGE_PROVIDER=azure-blob` |
| Express adapter over the handlers | Azure Functions | An equivalent adapter binding the **same handlers** to the Functions host |
| Express on :4000, Vite proxy | Functions app behind the same `/api` prefix | Env config only (`VITE_API_URL` if hosted apart) |

No frontend, service, repository-interface or API changes are required —
only a new storage provider, Azure Function entry points reusing the existing
handlers, and configuration.

## Phase 3 — Azure AD SSO via Azure Static Web Apps

Add authentication and production hosting:

- Host the client on **Azure Static Web Apps**, binding the API as its
  managed backend (or App Service + SWA linked API).
- **Azure Active Directory (Entra ID) SSO**; the Settings screen already
  reflects the intended tenant/allowed-domain configuration.
- Enforce the existing roles (Treasury / Approver / Submitter / Admin) in the
  API's service layer and scope data access per entity.

## Guiding principle

Each phase swaps out one layer without rewriting the UI:

```
Phase 1:  UI  →  localStorage
Phase 2:  UI  →  REST API → handlers → services → repositories → StorageProvider (local files / SQLite)
Azure:    UI  →  REST API → handlers → services → repositories → StorageProvider (Azure Blob), handlers on Azure Functions
Phase 3:  + Azure AD SSO + Azure Static Web Apps hosting
```
