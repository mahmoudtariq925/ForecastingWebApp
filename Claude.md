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

## Never
- Reintroduce Express.
- Reintroduce SQLite.
- Build a backend until requested.
