/**
 * Shown on configuration screens when the signed-in user may read but not
 * modify them (Treasury while the "Allow Treasury users to manage users and
 * settings" admin setting is off).
 */
export function ViewOnlyBadge({ hint }: { hint?: string }) {
  return (
    <span className="view-only-badge" title={hint ?? 'Ask an administrator to make changes'}>
      <span className="dot" />
      View Only
    </span>
  );
}
