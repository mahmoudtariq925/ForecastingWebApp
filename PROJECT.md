# Project Roadmap — Liquid Cash Flow Forecasting

This document captures where the project is today and how it is intended to
evolve. The architecture is deliberately staged so each phase is an additive,
low-risk step.

## Phase 1 — React frontend + localStorage (current)

**Status: built.**

- React + TypeScript + Vite + Tailwind CSS single-page app.
- All eight screens from the prototype, componentised, with the original
  visual design preserved exactly.
- Fully interactive with **mock data** defined in `src/data/mockData.ts`.
- **Persistence via browser `localStorage`**, wrapped entirely in
  `src/storage/localStorage.ts` (`saveData`/`loadData` plus named helpers such
  as `saveSubmission`, `loadSubmission`, `saveCycle`, `saveApprovals`,
  `saveUsers`, `saveSettings`).
- Deployed to GitHub Pages for instant browser preview.

There is **no backend yet** — everything lives in the browser. Data is
per-browser and not shared between users.

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
