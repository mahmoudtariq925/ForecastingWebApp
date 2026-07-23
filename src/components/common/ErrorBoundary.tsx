import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last line of defence: if any screen throws during render, show an
 * actionable recovery panel instead of unmounting to a blank page. The
 * reset button clears only this app's localStorage keys (all prefixed
 * "liquid:") — the standard fix when stored data from an older version
 * is the culprit.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] render error', error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  private resetData = () => {
    if (!confirm('Clear all locally stored forecasting data and reload? Seed data returns after the reload.')) {
      return;
    }
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('liquid:')) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch (err) {
      console.warn('[app] failed to clear storage', err);
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen">
        <div className="panel error-panel">
          <div className="crumb">Unexpected error</div>
          <h1>Something went wrong</h1>
          <p className="text-dim">
            The app hit an error while rendering. Reloading usually fixes a one-off; if it
            keeps happening, data stored by an older version of the app may be the cause —
            resetting local data returns the app to its seed state.
          </p>
          <pre className="error-detail">{this.state.error.message}</pre>
          <div className="row-flex">
            <button className="btn btn-primary" onClick={this.reload}>
              Reload
            </button>
            <button className="btn btn-danger" onClick={this.resetData}>
              Reset Local Data &amp; Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
