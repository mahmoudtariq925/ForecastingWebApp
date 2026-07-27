import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DialogProvider } from './components/common/DialogProvider';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <DialogProvider>
        <App />
      </DialogProvider>
    </ErrorBoundary>
  </StrictMode>,
);
