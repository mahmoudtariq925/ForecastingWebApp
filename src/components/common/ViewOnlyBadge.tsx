/**
 * Shown on configuration screens when the signed-in user may read but not
 * modify them (Treasury while the "Allow Treasury users to manage users and
 * settings" admin setting is off).
 *
 * `label` names what is locked when "view only" would be wrong — a submitter
 * answering questions on a reopened forecast is not a reader: they can still
 * reply and send it back, they just cannot rewrite the figures.
 */
export function ViewOnlyBadge({ hint, label = 'View Only' }: { hint?: string; label?: string }) {
  return (
    <span className="view-only-badge" title={hint ?? 'Ask an administrator to make changes'}>
      <span className="dot" />
      {label}
    </span>
  );
}
