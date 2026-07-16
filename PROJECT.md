# Project Roadmap — Liquid Cash Flow Forecasting

This document captures where the project is today and how it is intended to
evolve. The architecture is deliberately staged so each phase is an additive,
low-risk step.

## Phase 1 — React frontend + localStorage (done)

The original single-file prototype rebuilt as a React + TypeScript + Vite +
Tailwind app with all screens interactive and persistence in browser
`localStorage`. Superseded by Phase 2.

## Phase 2 — Client/server architecture (current)

**Status: built** — locally with SQLite + a filesystem uploads folder as
stand-ins for the Azure services.

- **Express API** (`server/`) exposing REST endpoints for all business data:
  users, forecast templates, template assignments, submissions, approvals,
  settings, entities, cycles, variances. The frontend communicates only
  through API calls — no local data files, nothing in localStorage.
- **Repository/service/controller layering**: controllers do HTTP only,
  services hold the business rules, repositories implement narrow
  persistence interfaces (`server/src/repositories/types.ts`).
- **SQLite** (`server/data/liquid.db`) as the temporary database behind the
  repository interfaces; the demo dataset is seeded on first boot.
- **Uploads folder** (`server/uploads/`) behind a `FileStorage` interface:
  template uploads store the physical .xlsx and create a database record
  referencing it; the structure is parsed server-side with the shared parser
  (`shared/excelTemplate.ts`).
- **Shared contracts** (`shared/types.ts`) typed against by both sides.

### Moving to Azure (the point of this phase's design)

| Local stand-in | Azure production | Change required |
| --- | --- | --- |
| SQLite via repository interfaces | Azure SQL | New repository implementations; swap the factory in `server/src/repositories/index.ts` |
| `server/uploads/` via `FileStorage` | Azure Blob Storage | New `FileStorage` implementation in `server/src/storage/fileStorage.ts` |
| Express on :4000, Vite proxy | App Service / Container Apps behind the same `/api` prefix | Env config only (`VITE_API_URL` if hosted apart) |

No frontend changes are required for either swap.

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
Phase 2:  UI  →  REST API  →  repositories (SQLite)  +  FileStorage (/uploads)
Azure:    UI  →  REST API  →  repositories (Azure SQL) + FileStorage (Blob)
Phase 3:  + Azure AD SSO + Azure Static Web Apps hosting
```
