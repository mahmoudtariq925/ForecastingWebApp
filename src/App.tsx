import { useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './components/dashboard/Dashboard';
import { AnalystHome } from './components/home/AnalystHome';
import { Cycles } from './components/cycles/Cycles';
import { Submission, type SubmissionTarget } from './components/submissions/Submission';
import { Approvals } from './components/approvals/Approvals';
import { Consolidated } from './components/consolidated/Consolidated';
import { Comparison } from './components/comparisons/Comparison';
import { CommentsReview } from './components/review/CommentsReview';
import { LegalEntitySetup } from './components/legalEntities/LegalEntitySetup';
import { Templates } from './components/templates/Templates';
import { Users } from './components/users/Users';
import { Settings } from './components/settings/Settings';
import { DataImport } from './components/dataImport/DataImport';
import { AppModals } from './components/common/AppModals';
import { useDialog } from './components/common/dialogContext';
import { useOnboardingTour } from './onboarding/useOnboardingTour';
import { listCycles } from './data/appData';
import {
  assignedEntitiesFor,
  currentUser,
  permissionsFor,
  setCurrentUser,
} from './data/session';
import {
  loadCycles,
  loadData,
  saveCycle,
  saveData,
  setSaveFailureHandler,
} from './storage/localStorage';
import type { Cycle } from './types';
import { allowedViews, landingViewFor } from './types/nav';
import type { ModalId, ViewId } from './types/nav';

export default function App() {
  // Mock session (Phase 3 swaps this for the Azure AD identity). Bumping the
  // version re-reads the user and remounts the screens.
  const [sessionVersion, setSessionVersion] = useState(0);
  const { notify } = useDialog();
  // Sidebar collapse is a local view preference (persisted, no backend).
  const [navCollapsed, setNavCollapsed] = useState(() =>
    loadData<boolean>('navCollapsed', false),
  );

  // A storage write that fails (quota, private mode) used to be swallowed, so
  // a submitter could fill in a grid and lose it on reload without a word.
  // Warn once per session rather than on every keystroke that follows.
  const warnedAboutStorage = useRef(false);
  useEffect(() => {
    setSaveFailureHandler(() => {
      if (warnedAboutStorage.current) return;
      warnedAboutStorage.current = true;
      void notify({
        tone: 'error',
        title: 'Changes are not being saved',
        message:
          'This browser refused to store your changes — usually because private browsing is on or its storage is full. Export anything you need before closing the tab.',
      });
    });
    return () => setSaveFailureHandler(null);
  }, [notify]);

  const toggleNavCollapsed = () => {
    setNavCollapsed((prev) => {
      saveData('navCollapsed', !prev);
      return !prev;
    });
  };
  const user = useMemo(() => {
    void sessionVersion;
    return currentUser();
  }, [sessionVersion]);
  const permissions = permissionsFor(user);
  const scopedEntities = permissionsFor(user).canViewAllEntities
    ? undefined
    : assignedEntitiesFor(user);

  const [view, setView] = useState<ViewId>(() => landingViewFor(permissionsFor(currentUser())));
  const [modal, setModal] = useState<ModalId>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Deep-link target for the Submission screen (set by Review / Approvals).
  const [submissionTarget, setSubmissionTarget] = useState<SubmissionTarget | null>(null);
  // Bumped whenever a shared modal writes to storage, remounting the active
  // screen so it reloads fresh data.
  const [dataVersion, setDataVersion] = useState(0);

  const navigate = (v: ViewId) => {
    // Plain navigation clears any pending deep-link so "My Submissions"
    // opens on its defaults again.
    if (v !== 'submission') setSubmissionTarget(null);
    setView(v);
    setMenuOpen(false);
  };

  const openSubmission = (target: SubmissionTarget) => {
    setSubmissionTarget(target);
    setView('submission');
    setMenuOpen(false);
  };

  const switchUser = (email: string) => {
    setCurrentUser(email);
    const next = currentUser();
    setSubmissionTarget(null);
    setView(landingViewFor(permissionsFor(next)));
    setSessionVersion((n) => n + 1);
    setDataVersion((n) => n + 1);
    setMenuOpen(false);
  };

  const createCycle = async (cycle: Cycle) => {
    saveCycle(cycle, loadCycles(listCycles()));
    setModal(null);
    setDataVersion((n) => n + 1);
    await notify({
      tone: 'success',
      title: 'Cycle opened',
      message: `Cycle ${cycle.id} opened. Notifications sent to submitters and approvers via Azure AD.`,
    });
  };

  const screens: Record<ViewId, JSX.Element> = {
    dashboard: <Dashboard onOpenModal={setModal} onNavigate={navigate} onOpenSubmission={openSubmission} />,
    analystHome: (
      <AnalystHome user={user} onOpenSubmission={openSubmission} onNavigate={navigate} />
    ),
    cycles: <Cycles onOpenModal={setModal} />,
    submission: (
      <Submission
        key={submissionTarget ? JSON.stringify(submissionTarget) : 'default'}
        initial={submissionTarget ?? undefined}
        allowedEntities={scopedEntities}
        readOnly={!permissions.canSubmitForecasts}
        canRequestComments={permissions.canReviewComments}
      />
    ),
    approvals: <Approvals onOpenSubmission={openSubmission} scopeEntities={scopedEntities} />,
    consolidated: <Consolidated />,
    comparison: <Comparison scopeEntities={scopedEntities} />,
    review: (
      <CommentsReview
        onOpenSubmission={openSubmission}
        scopeEntities={scopedEntities}
        canResolve={permissions.canReviewComments}
      />
    ),
    templates: <Templates />,
    legalEntities: <LegalEntitySetup />,
    users: <Users />,
    settings: <Settings />,
    dataImport: <DataImport onNavigate={navigate} />,
  };

  // A role never renders a screen its navigation doesn't grant.
  const allowed = allowedViews(permissions);
  const activeView = allowed.has(view) ? view : landingViewFor(permissions);

  // Guided walkthrough: auto-starts the first time a user signs in (or when
  // they follow an invite link), and can be replayed from the user menu.
  const { replay: replayTour } = useOnboardingTour({
    user,
    onNavigate: navigate,
    reachableViews: allowed,
  });

  return (
    <div className={`app${navCollapsed ? ' nav-collapsed' : ''}`}>
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
      <Sidebar
        active={activeView}
        user={user}
        onNavigate={navigate}
        onSwitchUser={switchUser}
        onReplayTour={replayTour}
        open={menuOpen}
        collapsed={navCollapsed}
        onToggleCollapsed={toggleNavCollapsed}
      />
      <main className="main" key={`${dataVersion}:${user.email}`}>
        {screens[activeView]}
      </main>
      <AppModals modal={modal} onClose={() => setModal(null)} onCreateCycle={createCycle} />
    </div>
  );
}
