# Treasury Cash Flow Forecasting Application

## Project Overview
- React
- TypeScript
- Vite
- Tailwind CSS

Current phase:
Frontend-only application using mock data.

Future architecture:
React frontend
↓
Azure Functions (REST API)
↓
Azure SQL Database
Azure Blob Storage

Do not implement backend code yet.

## Current Goal
Build a fully functional frontend:
- Responsive UI
- Working navigation
- Working buttons
- Excel import/export
- Forecast templates
- User management
- Approval workflow
- Forecast submissions
- Local persistence only

## Design Rules
- Keep current UI design.
- Keep typography and spacing consistent.
- No unnecessary redesigns.
- Prefer reusable components.

## Coding Standards
- Strict TypeScript.
- Functional React components.
- Small reusable components.
- Avoid duplicated logic.
- Keep business logic outside UI.

## Mock Data
During this phase:
- Mock data is acceptable.
- Local storage is acceptable.
- Services should be written so they can later be swapped for API calls.

## Future Migration
Every data access should eventually become:

Component
↓
Service
↓
Repository/API
↓
Azure Function

Avoid coupling components directly to storage.

## Excel
- Import real treasury templates.
- Export Excel with formulas.
- Preserve formatting.
## Testing Scope
Test the change, not the whole app.

- Verify what this change touched, and anything that shares code with it.
- Do not re-walk every screen and every role on every prompt.
- Always run: type check, lint, build.
- Reserve a full end-to-end run for a change to the forecast lifecycle (submit → approve → comment → return), or when asked for one.
## Pull Requests
Check whether the PR is already merged before pushing follow-up work.

A merged PR is closed permanently: it cannot take new commits, and pushing to
its branch does nothing. Work pushed after a merge is stranded on a branch with
no open PR pointing at it.

Before any follow-up push:
1. Check the PR's state. If it is merged, do NOT reuse it — the branch history
   is already in `main`.
2. Rebase the unmerged commits onto the latest `main`
   (`git fetch origin main && git rebase --onto origin/main <last-merged-sha>`),
   keeping the same branch name.
3. Push, then open a NEW PR. Never edit a merged PR's description to describe
   work it does not contain.

## Never
- Reintroduce Express.
- Reintroduce SQLite.
- Build a backend until requested.
