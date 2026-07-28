// ============================================================================
// Role-aware product tour definitions.
//
// EVERYTHING about the walkthrough lives in this file: which elements each
// role is shown, in what order, and what the popup says. Adding or reordering
// a step is a change here only — no tour logic is scattered through the
// screens. Components merely carry a stable `data-tour="…"` attribute, which
// is what these selectors target (CSS classes are free to change).
//
// Copy rules: plain English, one idea per step, no jargon, and say why the
// thing matters rather than just naming it.
// ============================================================================
import type { Role } from '../types';
import type { ViewId } from '../types/nav';

export interface TourStep {
  /**
   * Element to highlight. Omit for a centred step (used for welcome/closing
   * cards). A step whose element never appears is skipped automatically.
   */
  selector?: string;
  title: string;
  /** Short, plain-English explanation. */
  body: string;
  /** Screen this step lives on; the tour navigates there first. */
  view?: ViewId;
  /** Popover placement hint passed to driver.js. */
  side?: 'top' | 'right' | 'bottom' | 'left';
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** Steps every role gets at the start. */
function welcome(name: string, role: string): TourStep {
  return {
    title: `Welcome, ${name}`,
    body: `You've been set up as ${article(role)} ${role}. Here's a quick tour of the parts of Liquid you'll use — about a minute, and you can replay it any time from your name at the bottom of the menu.`,
  };
}

const CLOSING: TourStep = {
  title: 'That’s the tour',
  body: 'You can replay this any time: click your name at the bottom of the left menu and choose “Replay walkthrough”.',
};

/** Shared closer for the two roles that work inside a single forecast. */
const COMMENTS_STEP: TourStep = {
  view: 'review',
  selector: '[data-tour="nav-review"]',
  title: 'Comments and feedback',
  body: 'Anything Treasury has queried on your forecasts collects here, so you can see what still needs an explanation from you.',
  side: 'right',
};

const SUBMITTER_STEPS: TourStep[] = [
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-kpis"]',
    title: 'Your dashboard',
    body: 'Your current forecast cycle, the deadline, the entities you are responsible for, and how many things still need your attention.',
    side: 'bottom',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-forecast-actions"]',
    title: 'Open your forecast',
    body: 'One click takes you straight into this week’s forecast. It says “Continue” once you’ve started, so you always know where you left off.',
    side: 'left',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: 'Enter your numbers',
    body: 'Type directly into any cell, or paste a block straight from Excel. Money coming in is positive, money going out is negative. Totals and the running balance update as you type.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="orientation-toggle"]',
    title: 'Dates across or down',
    body: 'Flip the grid to whichever way you prefer to work. Your numbers stay exactly as they are — this only changes the layout.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="export-template"]',
    title: 'Working offline',
    body: 'Download this template as a blank workbook, fill it in outside Liquid, and keep it for your own records.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="variance-panel"]',
    title: 'Explaining big changes',
    body: 'Cells that moved a lot since last week get flagged. Click a flagged cell and add a short note — Treasury can’t close the cycle until those are explained.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="submit-forecast"]',
    title: 'Send it for approval',
    body: 'When the numbers look right, submit. Your approver is notified and takes it from there.',
    side: 'bottom',
  },
  COMMENTS_STEP,
];

const APPROVER_STEPS: TourStep[] = [
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-kpis"]',
    title: 'Your dashboard',
    body: 'The current cycle, its deadline, and the entities you’re responsible for approving.',
    side: 'bottom',
  },
  {
    view: 'approvals',
    selector: '[data-tour="approvals-table"]',
    title: 'Forecasts waiting for you',
    body: 'Everything submitted for your entities lands here, with how many cells were flagged as unusual and when it arrived.',
    side: 'top',
  },
  {
    view: 'approvals',
    selector: '[data-tour="approvals-review"]',
    title: 'Look before you decide',
    body: 'Open the full forecast to check the numbers and read the submitter’s explanations.',
    side: 'left',
  },
  {
    view: 'approvals',
    selector: '[data-tour="approvals-decide"]',
    title: 'Approve or send back',
    body: 'Approve when you’re happy. Rejecting returns it to the submitter to update and resubmit.',
    side: 'left',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: 'My Forecasts',
    body: 'You can prepare and submit forecasts for your own entities here too — the same grid your submitters use.',
    side: 'top',
  },
  COMMENTS_STEP,
];

const VIEWER_STEPS: TourStep[] = [
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-kpis"]',
    title: 'What you can see',
    body: 'You have read-only access to the entities assigned to you — useful for keeping an eye on the numbers without changing them.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="submission-filters"]',
    title: 'Choose what to look at',
    body: 'Pick the entity, year, month, week and template here. The grid below reloads to match.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: 'Reading the grid',
    body: 'Green means money in, red means money out, and stronger colour means a bigger number. The bottom rows show daily totals and the closing cash balance.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="export-excel"]',
    title: 'Take it with you',
    body: 'Export any view to Excel. You can’t edit or submit forecasts, but you can always download them.',
    side: 'bottom',
  },
  COMMENTS_STEP,
];

// Treasury is the full role: the whole forecast cycle AND the configuration
// screens the separate administrator role used to own. Its tour therefore
// covers every screen in its navigation, workspace first then admin.
const TREASURY_STEPS: TourStep[] = [
  {
    view: 'dashboard',
    selector: '[data-tour="dashboard-kpis"]',
    title: 'The whole picture',
    body: 'Total forecast, net cash position, how many entities have reported, and how many flagged cells still need explaining.',
    side: 'bottom',
  },
  {
    view: 'dashboard',
    selector: '[data-tour="requires-attention"]',
    title: 'What needs you today',
    body: 'Missing submissions, forecasts waiting for approval, unresolved comments and the biggest week-on-week moves — each one links straight to where you fix it.',
    side: 'top',
  },
  {
    view: 'dashboard',
    selector: '[data-tour="cycle-progress"]',
    title: 'Region by region',
    body: 'Track progress down from region to country, and chase anyone who hasn’t submitted with a pre-written email.',
    side: 'top',
  },
  {
    view: 'cycles',
    selector: '[data-tour="cycles-table"]',
    title: 'Forecast cycles',
    body: 'Every weekly cycle, what it collected and where it got to. Open a new cycle to start collecting, and close one when the numbers are final.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: 'Any entity’s forecast',
    body: 'You can open and edit any entity’s grid — useful for fixing a number yourself rather than sending it back.',
    side: 'top',
  },
  {
    view: 'approvals',
    selector: '[data-tour="approvals-table"]',
    title: 'Approvals',
    body: 'Everything submitted across the group, so you can approve or return a forecast without waiting for its local approver.',
    side: 'top',
  },
  {
    view: 'consolidated',
    selector: '[data-tour="nav-consolidated"]',
    title: 'Consolidated view',
    body: 'Every entity’s forecast added together, so you can see the group cash position and export it in one go.',
    side: 'right',
  },
  {
    view: 'comparison',
    selector: '[data-tour="comparison-tabs"]',
    title: 'Compare week to week',
    body: 'See what changed against the previous forecast — by entity, by category, or day by day — and which movements are still unexplained.',
    side: 'bottom',
  },
  {
    view: 'review',
    selector: '[data-tour="review-filters"]',
    title: 'Working through comments',
    body: 'Search and filter every outstanding comment, then mark them reviewed. A forecast stops blocking the cycle once its comments are cleared.',
    side: 'bottom',
  },
  // --- Configuration (previously the separate administrator role) ---
  {
    view: 'dataImport',
    selector: '[data-tour="data-import"]',
    title: 'Loading real data',
    body: 'Upload an Excel or CSV workbook per entity and week to populate the forecasts. Everything else on this screen updates from what you import.',
    side: 'top',
  },
  {
    view: 'templates',
    selector: '[data-tour="create-template"]',
    title: 'Building a template',
    body: 'Design a forecast in the browser — rows for your line items, sections and subtotals, columns for the periods — or upload an existing Excel file instead.',
    side: 'left',
  },
  {
    view: 'legalEntities',
    selector: '[data-tour="entity-selector"]',
    title: 'Legal Entity Setup',
    body: 'Pick an entity, then say who views, submits and approves for it. Only people with the matching role can be picked, so the two never get mixed up.',
    side: 'bottom',
  },
  {
    view: 'legalEntities',
    selector: '[data-tour="entity-template"]',
    title: 'Which template each entity uses',
    body: 'Set the forecast template an entity submits on. This is the only place that is decided — the Templates screen just reports it.',
    side: 'top',
  },
  {
    view: 'users',
    selector: '[data-tour="users-table"]',
    title: 'The people list',
    body: 'Everyone with access, their role, and which entities they’re responsible for. Responsibilities are read-only here — they come from Legal Entity Setup.',
    side: 'top',
  },
  {
    view: 'users',
    selector: '[data-tour="add-user"]',
    title: 'Adding someone',
    body: 'Set their name, email and role. Their role decides what they can do; where they can do it is set in Legal Entity Setup. Saving opens a ready-to-send invite email.',
    side: 'left',
  },
  {
    view: 'settings',
    selector: '[data-tour="settings-variance"]',
    title: 'Cycle and variance rules',
    body: 'Set how far the forecast looks ahead and how big a change has to be before it is flagged for commentary. These rules apply to every entity.',
    side: 'top',
  },
  CLOSING,
];

const BY_ROLE: Record<Role, TourStep[]> = {
  submitter: SUBMITTER_STEPS,
  approver: APPROVER_STEPS,
  viewer: VIEWER_STEPS,
  treasury: TREASURY_STEPS,
};

const ROLE_TITLE: Record<Role, string> = {
  submitter: 'Submitter',
  approver: 'Approver',
  viewer: 'Viewer',
  treasury: 'Treasury user',
};

/** The full step list for a user, welcome card included. */
export function tourFor(role: Role, firstName: string): TourStep[] {
  const steps = BY_ROLE[role] ?? BY_ROLE.submitter;
  return [welcome(firstName, ROLE_TITLE[role] ?? 'user'), ...steps];
}
