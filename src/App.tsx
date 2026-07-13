import { useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './components/dashboard/Dashboard';
import { Cycles } from './components/cycles/Cycles';
import { Submission } from './components/submissions/Submission';
import { Approvals } from './components/approvals/Approvals';
import { Consolidated } from './components/consolidated/Consolidated';
import { Comparison } from './components/comparisons/Comparison';
import { Users } from './components/users/Users';
import { Settings } from './components/settings/Settings';
import { AppModals, type VarianceDetail } from './components/common/AppModals';
import type { ModalId, ViewId } from './types/nav';

export default function App() {
  const [view, setView] = useState<ViewId>('dashboard');
  const [modal, setModal] = useState<ModalId>(null);
  const [varianceDetail, setVarianceDetail] = useState<VarianceDetail | undefined>();

  const openModal = (id: ModalId, detail?: VarianceDetail) => {
    setVarianceDetail(detail);
    setModal(id);
  };
  const closeModal = () => setModal(null);

  const openCycle = () => {
    closeModal();
    alert(
      'Cycle CW-2026-22 opened. Notifications sent to 14 submitters and 8 approvers via Azure AD.',
    );
  };

  const screens: Record<ViewId, JSX.Element> = {
    dashboard: <Dashboard onOpenModal={openModal} />,
    cycles: <Cycles onOpenModal={openModal} />,
    submission: <Submission onOpenModal={openModal} />,
    approvals: <Approvals />,
    consolidated: <Consolidated />,
    comparison: <Comparison />,
    users: <Users onOpenModal={openModal} />,
    settings: <Settings />,
  };

  return (
    <div className="app">
      <Sidebar active={view} onNavigate={setView} />
      <main className="main">{screens[view]}</main>
      <AppModals
        modal={modal}
        onClose={closeModal}
        varianceDetail={varianceDetail}
        onOpenCycle={openCycle}
      />
    </div>
  );
}
