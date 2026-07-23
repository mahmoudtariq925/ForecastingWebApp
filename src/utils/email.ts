// ============================================================================
// Frontend-only email integration. Composing happens in the user's desktop
// mail client (Outlook) via `mailto:` links — no backend service is involved.
// Recipients are resolved from the managed user list; names without an
// account fall back to the corporate address convention used by the seed
// data (e.g. "Anna Müller" → anna.mueller@contoso.com).
// ============================================================================
import type { Settings, User } from '../types';

export interface MailArgs {
  to: string | string[];
  cc?: string | string[];
  subject?: string;
  body?: string;
}

const list = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean).join(',');

/** Build a `mailto:` URL (RFC 6068) from recipients / subject / body. */
export function mailtoHref(args: MailArgs): string {
  const params = new URLSearchParams();
  const cc = list(args.cc);
  if (cc) params.set('cc', cc);
  if (args.subject) params.set('subject', args.subject);
  if (args.body) params.set('body', args.body);
  const query = params.toString().replace(/\+/g, '%20');
  return `mailto:${encodeURI(list(args.to))}${query ? `?${query}` : ''}`;
}

/** Open the user's desktop mail client (Outlook) with a prefilled draft. */
export function openEmail(args: MailArgs): void {
  // An anchor click (vs. assigning location.href) keeps SPA state untouched
  // if the OS shows a protocol-handler prompt, and stays unit-testable.
  const a = document.createElement('a');
  a.href = mailtoHref(args);
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The corporate mail domain from Settings ("@contoso.com" → "contoso.com"). */
export function mailDomain(settings: Settings): string {
  const first = settings.allowedDomains.split(/[,\s]+/)[0] ?? '@contoso.com';
  return first.replace(/^@/, '') || 'contoso.com';
}

// German umlauts / ß transliterate before the generic diacritic strip so the
// synthesized addresses match the seeded ones (Müller → mueller).
const TRANSLITERATE: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'ae', Ö: 'oe', Ü: 'ue',
};

/**
 * Email address for a person: their managed-user account when one exists,
 * otherwise first.last@<domain> following the seed-data convention.
 */
export function emailForName(name: string, users: User[], domain: string): string {
  const match = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
  if (match) return match.email;
  const slug = name
    .replace(/[äöüßÄÖÜ]/g, (ch) => TRANSLITERATE[ch] ?? ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, '')
    .trim()
    .split(/\s+/)
    .join('.');
  return `${slug || 'user'}@${domain}`;
}

/** The app URL to reference in email bodies (works on GitHub Pages too). */
export function appUrl(): string {
  return window.location.origin + window.location.pathname;
}
