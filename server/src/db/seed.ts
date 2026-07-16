// Seeds the database with the demo dataset on first boot (tables empty).
// This is the data that previously lived hardcoded in the frontend.
import fs from 'node:fs';
import type {
  Cycle,
  Entity,
  Settings,
  TemplateCategory,
  User,
  Variance,
} from '../../../shared/types';
import type { Repositories } from '../repositories/types.js';
import type { FileStorage } from '../storage/fileStorage.js';

export const STANDARD_TEMPLATE_ID = 'tpl-cf-standard';
const STANDARD_TEMPLATE_FILE = 'CF_Forecast_Template.xlsx';

const entities: Entity[] = [
  { name: 'Netherlands', submitter: 'Jan de Vries', approver: 'Pieter Bakker', total: 24350, delta: 2.1, status: 'approved' },
  { name: 'Germany', submitter: 'Anna Müller', approver: 'Klaus Weber', total: 31200, delta: -1.4, status: 'submitted' },
  { name: 'France', submitter: 'Marie Dubois', approver: 'Pierre Martin', total: 18900, delta: 4.7, status: 'pending' },
  { name: 'United Kingdom', submitter: 'James Patel', approver: "Sarah O'Brien", total: 22100, delta: 0.3, status: 'approved' },
  { name: 'Spain', submitter: 'Carlos Ruiz', approver: 'Elena García', total: 12400, delta: -2.8, status: 'submitted' },
  { name: 'Italy', submitter: 'Marco Rossi', approver: 'Giulia Conti', total: 9200, delta: 1.1, status: 'approved' },
  { name: 'Poland', submitter: 'Tomasz Nowak', approver: 'Anna Wójcik', total: 7600, delta: -0.9, status: 'pending' },
  { name: 'Belgium', submitter: 'Sophie Janssens', approver: 'Luc De Smet', total: 6450, delta: 3.2, status: 'approved' },
  { name: 'Switzerland', submitter: 'Hans Müller', approver: 'Beat Wyss', total: 4200, delta: 0.0, status: 'submitted' },
  { name: 'Austria', submitter: 'Lukas Huber', approver: 'Maria Gruber', total: 2800, delta: 1.8, status: 'approved' },
  { name: 'Portugal', submitter: 'João Silva', approver: 'Ana Costa', total: 1900, delta: -3.4, status: 'pending' },
];

const users: User[] = [
  { name: 'Maja Kowalska', email: 'maja.kowalska@contoso.com', team: 'Treasury HQ', role: 'admin', scope: 'All entities', last: 'Now' },
  { name: 'Jan de Vries', email: 'jan.devries@contoso.com', team: 'NL Operations', role: 'submitter', scope: '—', last: '2h ago' },
  { name: 'Pieter Bakker', email: 'pieter.bakker@contoso.com', team: 'NL Operations', role: 'approver', scope: 'NL Operations', last: '1h ago' },
  { name: 'Anna Müller', email: 'anna.mueller@contoso.com', team: 'DE Sales', role: 'submitter', scope: '—', last: '4h ago' },
  { name: 'Klaus Weber', email: 'klaus.weber@contoso.com', team: 'DE Sales', role: 'approver', scope: 'DE Sales, DE Manufacturing', last: '3h ago' },
  { name: "Sarah O'Brien", email: 'sarah.obrien@contoso.com', team: 'UK Services', role: 'approver', scope: 'UK Services, UK Support', last: 'Yesterday' },
  { name: 'Linda Chen', email: 'linda.chen@contoso.com', team: 'Treasury HQ', role: 'treasury', scope: 'All entities', last: '20m ago' },
];

const cycles: Cycle[] = [
  { id: 'CW-2026-21', start: 'May 18', closes: 'May 22 · 18:00', status: 'submitted', subs: '14 / 18', total: 184.2 },
  { id: 'CW-2026-20', start: 'May 11', closes: 'May 15 · 18:00', status: 'consolidated', subs: '18 / 18', total: 178.4 },
  { id: 'CW-2026-19', start: 'May 04', closes: 'May 08 · 18:00', status: 'consolidated', subs: '18 / 18', total: 181.0 },
  { id: 'CW-2026-18', start: 'Apr 27', closes: 'May 01 · 18:00', status: 'consolidated', subs: '17 / 17', total: 175.8 },
  { id: 'CW-2026-17', start: 'Apr 20', closes: 'Apr 24 · 18:00', status: 'consolidated', subs: '17 / 17', total: 172.1 },
];

const variances: Variance[] = [
  { ent: 'NL Operations', cat: 'Customer Receipts', day: 'Day 14', prior: 2150, current: 2883, comment: 'Large invoice — Acme Corp paid early' },
  { ent: 'DE Sales', cat: 'Supplier Payments', day: 'Day 8', prior: -1820, current: -2540, comment: 'New equipment delivery moved forward' },
  { ent: 'US Corporate', cat: 'Tax Payments', day: 'Day 21', prior: 0, current: -3200, comment: '' },
  { ent: 'FR Manufacturing', cat: 'Payroll', day: 'Day 15', prior: -890, current: -1340, comment: 'Bonus accruals included' },
  { ent: 'UK Services', cat: 'Customer Receipts', day: 'Day 5', prior: 1450, current: 1820, comment: 'Pipeline tightening — confirmed deals' },
];

const defaultSettings: Settings = {
  horizon: '30 days',
  frequency: 'Weekly (Mon → Fri close)',
  varianceThreshold: 15,
  minValueToTrigger: '50,000',
  exemptNewPeriods: "Yes — never flag days outside prior cycle's horizon",
  ssoProvider: 'Azure Active Directory · Tenant: contoso.onmicrosoft.com',
  allowedDomains: '@contoso.com',
};

/** Categories of the standard CF_Forecast_Template workbook. */
const standardCategories: TemplateCategory[] = [
  { label: 'Receivables', group: 'Trade AR & AP' },
  { label: 'Payables', group: 'Trade AR & AP' },
  { label: 'Corporate Income', group: 'Taxes' },
  { label: 'Other Taxes', group: 'Taxes' },
  { label: 'Salaries', group: 'Payroll' },
  { label: 'Social Securities', group: 'Payroll' },
  { label: 'CAPEX' },
  { label: 'IC Inflows - NL', group: 'IC Settlements' },
  { label: 'IC Outflows - NL', group: 'IC Settlements' },
  { label: 'IC Inflows', group: 'IC Settlements' },
  { label: 'IC Outflows', group: 'IC Settlements' },
  { label: 'Other' },
];

export async function seedIfEmpty(
  repos: Repositories,
  files: FileStorage,
  standardTemplateSource: string,
): Promise<void> {
  if (repos.entities.list().length === 0) {
    for (const e of entities) repos.entities.insert(e);
  }
  if (repos.users.list().length === 0) {
    for (const u of users) repos.users.create(u);
  }
  if (repos.cycles.list().length === 0) {
    // Insert oldest-first so the newest ends up on top (lowest sort).
    for (const c of [...cycles].reverse()) repos.cycles.create(c);
  }
  try {
    repos.settings.get();
  } catch {
    repos.settings.put(defaultSettings);
  }
  if (repos.variances.list().length === 0) {
    for (const v of variances) repos.variances.insert(v);
  }
  if (repos.templates.list().length === 0) {
    // Store the physical workbook in file storage and reference it.
    let fileKey: string | undefined;
    try {
      const bytes = await fs.promises.readFile(standardTemplateSource);
      fileKey = await files.put(STANDARD_TEMPLATE_FILE, bytes);
    } catch (err) {
      console.warn('[seed] standard template workbook not found:', err);
    }
    repos.templates.create({
      id: STANDARD_TEMPLATE_ID,
      name: 'CF Forecast (Standard)',
      fileName: STANDARD_TEMPLATE_FILE,
      fileKey,
      uploadedAt: '2026-07-01T09:00:00.000Z',
      uploadedBy: 'Maja Kowalska',
      layout: 'grouped',
      categories: standardCategories,
    });
    repos.templates.setAssignments(
      STANDARD_TEMPLATE_ID,
      entities.map((e) => e.name),
    );
  }
}
