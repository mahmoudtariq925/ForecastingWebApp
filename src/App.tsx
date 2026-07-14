import { useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './components/dashboard/Dashboard';
import { Cycles } from './components/cycles/Cycles';
import { Submission } from './components/submissions/Submission';
import { Approvals } from './components/approvals/Approvals';
import { Consolidated } from './components/consolidated/Consolidated';
import { Comparison } from './components/comparisons/Comparison';
import { Templates } from './components/templates/Templates';
import { Users } from './components/users/Users';
import { Settings } from './components/settings/Settings';
import { AppModals } from './components/common/AppModals';
import { cycles as seedCycles } from './data/mockData';
import { loadCycles, saveCycle } from './storage/localStorage';
import type { Cycle } from './types';
import type { ModalId, ViewId } from './types/nav';

export default function App() {
  const [view, setView] = useState<ViewId>('dashboard');
  const [modal, setModal] = useState<ModalId>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Bumped whenever a shared modal writes to storage, remounting the active
  // screen so it reloads fresh data.
  const [dataVersion, setDataVersion] = useState(0);

  const navigate = (v: ViewId) => {
    setView(v);
    setMenuOpen(false);
  };

  const createCycle = (cycle: Cycle) => {
    saveCycle(cycle, loadCycles(seedCycles));
    setModal(null);
    setDataVersion((n) => n + 1);
    alert(
      `Cycle ${cycle.id} opened. Notifications sent to submitters and approvers via Azure AD.`,
    );
  };

  const screens: Record<ViewId, JSX.Element> = {
    dashboard: <Dashboard onOpenModal={setModal} onNavigate={navigate} />,
    cycles: <Cycles onOpenModal={setModal} />,
    submission: <Submission />,
    approvals: <Approvals />,
    consolidated: <Consolidated />,
    comparison: <Comparison />,
    templates: <Templates />,
    users: <Users />,
    settings: <Settings />,
  };

  return (
    <div className="app">
      <button
        className="menu-btn"
        aria-label="Open navigation"
        onClick={() => setMenuOpen(true)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <div
        className={`sidebar-backdrop${menuOpen ? ' show' : ''}`}
        onClick={() => setMenuOpen(false)}
      />
      <Sidebar active={view} onNavigate={navigate} open={menuOpen} />
      <main className="main" key={dataVersion}>
        {screens[view]}
      </main>
      <AppModals modal={modal} onClose={() => setModal(null)} onCreateCycle={createCycle} />
    </div>
  );
}
