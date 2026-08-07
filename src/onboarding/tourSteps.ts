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
    selector: '[data-tour="cycle-chip"]',
    title: 'The period is set for you',
    body: 'Nothing to pick: the dates follow the cycle Treasury opened, and the template is fixed for your entity. You only ever bring the numbers.',
    side: 'bottom',
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

// ---------------------------------------------------------------------------
// Journey walkthroughs. After the what-is-where steps, the tour runs one
// cycle END TO END on the real screens — first number to feedback — like a
// narrated screen recording the user clicks through. Submitters and
// approvers each get their own; treasury (who knows the whole system) none.
// ---------------------------------------------------------------------------
const SUBMITTER_JOURNEY: TourStep[] = [
  {
    title: 'Now — a week in your shoes',
    body: 'That was the map. Next, one forecast cycle from start to finish, exactly as you’ll work it every week: enter, explain, submit, and hear back.',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: '1 · Monday: the numbers go in',
    body: 'You start here. Click any cell and type, or paste a whole block from your own workbook. Watch the totals and the chart below rebuild as you go.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="variance-panel"]',
    title: '2 · Explain what moved',
    body: 'Anything far off last week’s number gets an amber flag. Click the flagged cell, say why in a sentence — “VAT settlement lands Tuesday” is plenty.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="submit-forecast"]',
    title: '3 · Submit',
    body: 'Press this when you’re done. If any flag still lacks a note, Liquid walks you through them one by one — each cell spotlit with the comment box beside it — and submits when you’ve answered the last one.',
    side: 'bottom',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="analyst-todo"]',
    title: '4 · Watch it move',
    body: 'Back home, step 1 turns green and the cycle moves to your approver. If they return the forecast, it comes straight back here marked “returned for update”.',
    side: 'bottom',
  },
  {
    view: 'review',
    selector: '[data-tour="nav-review"]',
    title: '5 · Read the feedback',
    body: 'Questions from Treasury and your approver’s notes collect here, next to your answers. Reply, adjust the numbers if needed, resubmit — that’s the whole loop.',
    side: 'right',
  },
  CLOSING,
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
    selector: '[data-tour="approver-queue"]',
    title: 'Your countries, right here',
    body: 'Every entity you approve for, with its status and flag count. Approving happens from this list — there is no separate approvals screen to keep open.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: 'Read the full forecast',
    body: 'Review opens the submitter’s grid read-only — their numbers, their commentary on the flagged cells. Reviewing never risks changing anything.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="approve-forecast"]',
    title: 'Decide on the spot',
    body: 'Happy with what you read? Approve without leaving the page. The decision lands on the submitter’s screen immediately.',
    side: 'bottom',
  },
  COMMENTS_STEP,
];

const APPROVER_JOURNEY: TourStep[] = [
  {
    title: 'Now — an approval, start to finish',
    body: 'That was the map. Next, one review exactly as you’ll do it each week: a forecast arrives, you read it, question it if something looks off, and approve.',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="up-next"]',
    title: '1 · A forecast arrives',
    body: '“Up next” flips to “approve the forecasts waiting on you” the moment a submitter presses Submit. That’s your cue.',
    side: 'bottom',
  },
  {
    view: 'analystHome',
    selector: '[data-tour="approver-queue"]',
    title: '2 · Open the country',
    body: 'Review opens the full grid to read first. Approve, when you already trust the numbers, shows you the forecast and its chart one last time before you confirm.',
    side: 'bottom',
  },
  {
    view: 'submission',
    selector: '[data-tour="forecast-grid"]',
    title: '3 · Interrogate the numbers',
    body: 'Sections open collapsed so you see the shape first — expand the ones that look odd. Amber cells carry the submitter’s explanations; hover any ✎ to ask about a number that doesn’t.',
    side: 'top',
  },
  {
    view: 'submission',
    selector: '[data-tour="approve-forecast"]',
    title: '4 · Approve',
    body: 'One click, one confirmation, done — the submitter sees it instantly, and your checklist ticks over to “await treasury”.',
    side: 'bottom',
  },
  {
    view: 'review',
    selector: '[data-tour="nav-review"]',
    title: '5 · Keep the conversation',
    body: 'Anything you or Treasury asked, and every answer, stays threaded here — so next week starts with the context of this one.',
    side: 'right',
  },
  CLOSING,
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
    body: 'Pick the entity here — the period and template follow the active cycle, so what you see is always the same forecast the submitter is working on.',
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

// Submitters and approvers get the page tour, then their journey; treasury
// runs the whole system and viewers act on nothing, so neither gets one.
const BY_ROLE: Record<Role, TourStep[]> = {
  submitter: [...SUBMITTER_STEPS, ...SUBMITTER_JOURNEY],
  approver: [...APPROVER_STEPS, ...APPROVER_JOURNEY],
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
