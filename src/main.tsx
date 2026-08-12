import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DialogProvider } from './components/common/DialogProvider';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { activeWeekKey } from './data/cycleService';
import { seedDemoWorkflow } from './data/demoSeed';
import './index.css';

// The demo's opening position is real stored submissions with real statuses,
// so it has to exist before the first screen reads anything. Seeding from an
// effect inside App left the dashboard rendering an empty cycle on first paint.
seedDemoWorkflow(activeWeekKey());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ErrorBoundary>
  </StrictMode>,
);
