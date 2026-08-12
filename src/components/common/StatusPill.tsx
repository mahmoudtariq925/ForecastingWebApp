import { statusLabel } from '../../data/submissionService';
import type { SubmissionStatus } from '../../types';

/** Status pill (`.status`) with a leading dot. `label` overrides the text. */
export function StatusPill({
  status,
  label,
}: {
  status: SubmissionStatus;
  label?: string;
}) {
  return (
    <span className={`status ${status}`}>
      <span className="dot" />
      {label ?? statusLabel(status)}
    </span>
  );
}
