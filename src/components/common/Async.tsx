import { TopBar } from '../layout/TopBar';

/** Placeholder while a screen's data is loading from the API. */
export function LoadingView({ crumb, title }: { crumb: string; title: string }) {
  return (
    <div className="view active">
      <TopBar crumb={crumb} title={title} />
      <div className="content">
        <div className="panel">
          <div className="empty-state">
            <div className="ic">◌</div>
            <p>Loading…</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shown when an API call fails (e.g. the backend isn't running). */
export function ErrorView({
  crumb,
  title,
  message,
  onRetry,
}: {
  crumb: string;
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="view active">
      <TopBar crumb={crumb} title={title} />
      <div className="content">
        <div className="panel">
          <div className="empty-state">
            <div className="ic">⚠</div>
            <p>
              Could not reach the Liquid API: <strong>{message}</strong>
            </p>
            <p className="text-muted" style={{ marginTop: 8 }}>
              Start the backend with <code>npm run dev</code> (runs client + server) or{' '}
              <code>npm run dev:server</code>.
            </p>
            {onRetry && (
              <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
