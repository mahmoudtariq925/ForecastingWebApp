// ============================================================================
// Asking a submitter to explain a cell.
//
// Three screens ask the same question — the forecast grid, the forecast
// preview dialog and Comments Review — and each used to build the request and
// the email itself. They drifted: one recorded who asked, another didn't, and
// the wording of the mail depended on where the question was raised from. All
// of it lives here, so a question is the same thing wherever it is asked.
// ============================================================================
import type { CommentRequest } from '../types';
import { lineOwners, type LineOwner } from './legalEntityService';
import { currentUser, requesterRoleFor } from './session';
import { weekLabel } from './periods';
import { requestComment } from './submissionService';
import { appUrl, openEmail } from '../utils/email';

/** The cell a question is about, with everything the mail draft quotes. */
export interface CommentaryTarget {
  entity: string;
  /** Forecast week key (the Monday). */
  week: string;
  templateId: string;
  /** Cell key, `${catIdx}-${dayIdx}`. */
  cellKey: string;
  /** Line item, e.g. "Corporate Income". */
  label: string;
  /** Which column, e.g. "Mon 3 Aug" or "Day 3". */
  periodLabel: string;
  current: number;
  prior: number | null;
  /** Commentary the submitter has already written on this cell, if any. */
  comment?: string;
}

const fmtK = (v: number) => `€${Math.round(v).toLocaleString()}k`;

/**
 * Who a question about this cell would go to, or null when nobody is assigned
 * to submit it.
 *
 * Line items can have owners of their own (Legal Entity Setup), so a question
 * about salaries goes to whoever forecasts salaries rather than to whoever is
 * first in the entity's submitter list. Worth its own answer, because "no
 * submitter" used to end in a mail draft addressed to an address synthesized
 * from an empty name — the question looked sent and reached nobody.
 */
export function submitterFor(
  entity: string,
  /** Line item the question is about; omitted, the entity's submitters. */
  lineLabel?: string,
): LineOwner | null {
  return lineOwners(entity, lineLabel)[0] ?? null;
}

/**
 * Record the question on the cell and open a draft to whoever submits for that
 * entity. Returns the stored request so the calling screen can show it without
 * re-reading storage.
 *
 * The submitter is not sitting in the app waiting to be asked, so the email is
 * part of asking rather than a separate courtesy step.
 */
export function askForCommentary(target: CommentaryTarget, message: string): CommentRequest {
  const me = currentUser();
  const request: CommentRequest = {
    from: me.name,
    fromRole: requesterRoleFor(me),
    message,
    requestedAt: new Date().toISOString(),
  };
  requestComment(target.week, target.entity, target.templateId, target.cellKey, request);

  const to = submitterFor(target.entity, target.label);
  const submitter = to?.name ?? 'there';
  openEmail({
    to: to?.email ?? '',
    subject:
      `Question on the ${target.entity} forecast — ${target.label} · ` +
      `${target.periodLabel} · ${weekLabel(target.week)}`,
    body:
      `Hi ${submitter.split(' ')[0]},\n\n` +
      `I have a question about the ${target.entity} cash flow forecast for ` +
      `${weekLabel(target.week)}.\n\n` +
      `Line item: ${target.label}\n` +
      `Period: ${target.periodLabel}\n` +
      `Current value: ${fmtK(target.current)}\n` +
      (target.prior === null ? '' : `Prior forecast: ${fmtK(target.prior)}\n`) +
      (target.comment?.trim() ? `\nYour commentary so far:\n${target.comment.trim()}\n` : '') +
      `\nQuestion:\n${message}\n\n` +
      `Please add your commentary on that cell: ${appUrl()}\n\n` +
      `Best regards,\n${me.name}\n${me.email}`,
  });
  return request;
}
