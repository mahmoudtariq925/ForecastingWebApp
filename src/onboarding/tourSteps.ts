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
  body: 'Every question Treasury has raised on your entities collects here, together with the answers, so the state of the conversation is never in doubt.',
  side: 'right',
};

const SUBMITTER_STEPS: TourStep[] = [
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-todo"]',
    title: 'Your cycle checklist',
    body: 'The three steps of every cycle, in order: submit your forecast, clear any review, then wait for Treasury. The “Up next” line above always says what to do now.',
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
    body: 'Save Draft keeps a checkpoint you can reset back to; Submit sends the forecast on. Both live here with the rest of the grid actions.',
    side: 'bottom',
  },
];

// ---------------------------------------------------------------------------
// Journeys. After the controls have been introduced, walk the same screens
// again IN THE ORDER A WEEK ACTUALLY HAPPENS — a guided run-through of the
// submitter's and the approver's week, like a narrated demo video. Treasury
// runs the whole system and gets no journey; their tour covers every screen.
// ---------------------------------------------------------------------------

const SUBMITTER_JOURNEY: TourStep[] = [
  {
    title: 'Now — a week in your shoes',
    body: 'Those were the controls. Next, the journey: the same screens in the order you will actually use them, from the cycle opening to Treasury signing off.',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-cycle"]',
    title: '1 · A cycle opens',
    body: 'Treasury opens the weekly cycle and sets its deadline. That decides the period you forecast — you never pick dates yourself.',
    side: 'bottom',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="todo-submit"]',
    title: '2 · Start from the checklist',
    body: 'Submit Forecast shows you the saved forecast and chart in one box. Submit from there when it is ready, or open the full page to keep working.',
    side: 'left',
  },
  {
    view: 'submission',
    selector: '[data-tour="cycle-scope"]',
    title: '3 · The period is set for you',
    body: 'On the forecast page, the cycle badge shows exactly which dates you are forecasting. The template is fixed too — Treasury configures it per entity.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: '4 · Fill in the numbers',
    body: 'Type or paste your cash flows. Cells that moved a lot versus last week get an amber flag — click one to explain it, or leave them for submit time.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="save-draft"]',
    title: '5 · Save as you go',
    body: 'Save Draft keeps a checkpoint. If an experiment goes wrong, Reset returns to your last saved draft — and Ctrl+Z / Ctrl+Y undo and redo.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="submit-forecast"]',
    title: '6 · Submit',
    body: 'On submit, any unexplained variance is spotlighted in the grid with a comment box beside it — write each note and the forecast goes to your approver by itself.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-chart"]',
    title: '7 · Sense-check the shape',
    body: 'The chart redraws as you type, and can overlay your recent cycles — a quick way to spot something odd before your approver does.',
    side: 'top',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="todo-feedback"]',
    title: '8 · After you submit',
    body: 'Your approver reviews and approves, then Treasury consolidates. If anything comes back — a question or a returned forecast — it appears on this checklist.',
    side: 'top',
  },
  {
    view: 'review',
    selector: '[data-tour="nav-review"]',
    title: '9 · The conversation',
    body: 'Every question on your numbers and every answer you give collects under Comments / Feedback, so nothing gets lost in email.',
    side: 'right',
  },
];

const APPROVER_STEPS: TourStep[] = [
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-todo"]',
    title: 'Your cycle checklist',
    body: 'The cycle in three steps: your submitters get their forecasts in, you review and approve them, then Treasury closes the cycle. The “Up next” line says whose move it is.',
    side: 'bottom',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="todo-approvals"]',
    title: 'Decide from right here',
    body: 'Every country you approve for is listed with its status. Review opens the full forecast; Approve shows it once more and signs it off.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: 'Read the full forecast',
    body: 'Every forecast for your entities opens here read-only — the same grid your submitters fill in, with their commentary on the flagged cells. Reviewing never risks changing their numbers.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="approve-forecast"]',
    title: 'Approve in place',
    body: 'Happy with what you see? Approve without leaving the page — no separate approvals screen to hunt for.',
    side: 'bottom',
  },
];

const APPROVER_JOURNEY: TourStep[] = [
  {
    title: 'Now — a cycle through your eyes',
    body: 'Those were the controls. Next, the journey: how a week runs for you, from the first submission arriving to the cycle closing.',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-cycle"]',
    title: '1 · The cycle opens',
    body: 'Treasury opens the weekly cycle; your submitters start filling in their forecasts. The banner shows the deadline everyone is working to.',
    side: 'bottom',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="todo-approvals"]',
    title: '2 · Forecasts arrive',
    body: 'As each country submits, its row turns “submitted” and waits on you. Start with Review — it opens the actual numbers.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: '3 · Review the detail',
    body: 'Sections open collapsed so you see the shape first; expand what you want to inspect. The ✎ on any cell asks the submitter to explain that number.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="approve-forecast"]',
    title: '4 · Approve',
    body: 'Approve here, or from the checklist’s Approve button — that one shows you the forecast and chart once more before you confirm.',
    side: 'bottom',
  },
  {
    view: 'review',
    selector: '[data-tour="nav-review"]',
    title: '5 · Keep up with the answers',
    body: 'Questions you or Treasury raise, and the submitters’ answers, collect here — check it before the cycle closes.',
    side: 'right',
  },
];

const VIEWER_STEPS: TourStep[] = [
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-todo"]',
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
    selector: '[data-tour="entity-table"]',
    title: 'Legal Entity Setup',
    body: 'Click any entity to open its setup, then say who views, submits and approves for it. Only people with the matching role can be picked, so the two never get mixed up.',
    side: 'top',
  },
  {
    view: 'legalEntities',
    selector: '[data-tour="entity-template"]',
    title: 'Which template each entity uses',
    body: 'Each entity submits on its own forecast template. That is decided here and nowhere else — the Templates screen only reports it.',
    side: 'bottom',
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

// Submitters and approvers get their journey appended after the control
// tour; treasury and viewers do not (the whole system / read-only).
const BY_ROLE: Record<Role, TourStep[]> = {
  submitter: [...SUBMITTER_STEPS, ...SUBMITTER_JOURNEY, CLOSING],
  approver: [...APPROVER_STEPS, ...APPROVER_JOURNEY, CLOSING],
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
