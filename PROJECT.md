# Project Roadmap — Liquid Cash Flow Forecasting

This document captures where the project is today and how it is intended to
evolve. The architecture is deliberately staged so each phase is an additive,
low-risk step.

## Phase 1 — React frontend + localStorage (current)

**Status: built.**

- React + TypeScript + Vite + Tailwind CSS single-page app.
- All screens from the prototype plus a **Forecast Templates** section,
  componentised, with the original visual design preserved exactly.
- **Forecast templates**: upload real .xlsx files (parsed in-browser with
  exceljs), assign them per country/region, edit / replace / download / remove.
- **Dynamic submissions**: entity + reporting period (month/year) + template
  selectors; the grid layout is driven by the selected template. Each
  (entity, period, template) submission is stored separately, so historical
  periods remain viewable and editable without affecting current ones.
- **Real file features**: Excel import populates the grid, exports generate
  valid .xlsx/.csv/.json downloads, paste-from-Excel fills cells, variance
  flags carry per-cell commentary.
- **Responsive**: the sidebar collapses to a drawer below ~900px and wide
  tables scroll within their panels.
- Seed data in `src/data/mockData.ts`; **persistence via browser
  `localStorage`**, wrapped entirely in `src/storage/localStorage.ts`
  (`saveData`/`loadData` plus named helpers such as `saveSubmission`,
  `loadSubmission`, `saveCycle`, `saveTemplates`, `saveApprovals`,
  `saveUsers`, `saveSettings`).
- Deployed to GitHub Pages for instant browser preview.

There is **no backend yet** — everything lives in the browser. Data is
per-browser and not shared between users; uploaded template files are stored
as base64 in localStorage (capped at 1 MB per file until Phase 2).

## Phase 2 — Azure Blob Storage via Azure Functions API

Replace the localStorage persistence with a real, shared backend.

- Stand up an **Azure Functions** app exposing a small REST API (submissions,
  cycles, approvals, users, settings).
- Persist data in **Azure Blob Storage** (one blob/container per cycle, or a
  document store as appropriate).
- Reimplement `src/storage/localStorage.ts` against the API (fetch calls) — the
  function signatures stay the same, so **no screen component changes**. This
  is the reason all persistence is funnelled through that one module today.
- Introduce async loading states where reads become network calls.

## Phase 3 — Azure AD SSO via Azure Static Web Apps

Add authentication and hosting suited to an internal treasury tool.

- Host the frontend on **Azure Static Web Apps** (which can also bind the
  Phase 2 Azure Functions as its managed API).
- Add **Azure Active Directory (Entra ID) SSO** so users sign in with their
  corporate identity; the Settings screen already reflects the intended
  tenant/allowed-domain configuration.
- Enforce the existing roles (Treasury / Approver / Submitter / Admin) on the
  server side and scope data access per entity.

## Guiding principle

Each phase swaps out one layer without rewriting the UI:

```
Phase 1:  UI  ->  storage/localStorage.ts  ->  browser localStorage
Phase 2:  UI  ->  storage/localStorage.ts  ->  Azure Functions  ->  Blob Storage
Phase 3:  + Azure AD SSO + Azure Static Web Apps hosting
```
