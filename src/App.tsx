import { useEffect, useMemo, useRef, useState } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './components/dashboard/Dashboard';
import { AnalystHome } from './components/home/AnalystHome';
import { Cycles } from './components/cycles/Cycles';
import { Submission, type SubmissionTarget } from './components/submissions/Submission';
import { CommentsReview } from './components/review/CommentsReview';
import { QuestionsReview } from './components/review/QuestionsReview';
import { LegalEntitySetup } from './components/legalEntities/LegalEntitySetup';
import { Templates } from './components/templates/Templates';
import { Users } from './components/users/Users';
import { Settings } from './components/settings/Settings';
import { DataImport } from './components/dataImport/DataImport';
import { AppModals } from './components/common/AppModals';
import { useDialog } from './components/common/dialogContext';
import { useOnboardingTour } from './onboarding/useOnboardingTour';
import { cycleIdFor, openCycleForWeek } from './data/cycleService';
import { seedDemoWorkflow } from './data/demoSeed';
import {
  assignedEntitiesFor,
  currentUser,
  permissionsFor,
  setCurrentUser,
} from './data/session';
import { weekLabel } from './data/periods';
import { loadData, saveData, setSaveFailureHandler } from './storage/localStorage';
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

  // -------------------------------------------------------------------------
  // Navigation and browser history.
  //
  // Screen changes are React state, not URLs. That is fine until someone
  // presses Back: with nothing ever pushed onto the history stack, the browser
  // had no in-app entry to return to and left the app entirely — mid-forecast,
  // with no warning. Each navigation now pushes an entry carrying the view it
  // moved to, and popstate puts that view back.
  // -------------------------------------------------------------------------
  const pushHistory = (v: ViewId, target: SubmissionTarget | null) => {
    window.history.pushState({ liquidView: v, liquidTarget: target }, '');
  };

  const navigate = (v: ViewId) => {
    // Plain navigation clears any pending deep-link so "My Submissions"
    // opens on its defaults again.
    const target = v === 'submission' ? submissionTarget : null;
    if (v !== 'submission') setSubmissionTarget(null);
    if (v !== view) pushHistory(v, target);
    setView(v);
    setMenuOpen(false);
  };

  const openSubmission = (target: SubmissionTarget) => {
    setSubmissionTarget(target);
    pushHistory('submission', target);
    setView('submission');
    setMenuOpen(false);
  };

  useEffect(() => {
    window.history.replaceState(
      { liquidView: landingViewFor(permissionsFor(currentUser())), liquidTarget: null },
      '',
    );
    const onPop = (e: PopStateEvent) => {
      const state = e.state as { liquidView?: ViewId; liquidTarget?: SubmissionTarget | null } | null;
      if (!state?.liquidView) return;
      setSubmissionTarget(state.liquidTarget ?? null);
      setView(state.liquidView);
      setMenuOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // Runs once: the listener reads the view out of the history entry itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchUser = (email: string) => {
    setCurrentUser(email);
    const next = currentUser();
    const landing = landingViewFor(permissionsFor(next));
    setSubmissionTarget(null);
    pushHistory(landing, null);
    setView(landing);
    setSessionVersion((n) => n + 1);
    setDataVersion((n) => n + 1);
    setMenuOpen(false);
  };

  const createCycle = async (weekKey: string) => {
    openCycleForWeek(weekKey);
    seedDemoWorkflow(weekKey);
    setModal(null);
    setDataVersion((n) => n + 1);
    await notify({
      tone: 'success',
      title: 'Cycle opened',
      message: `Cycle ${cycleIdFor(weekKey)} opened for ${weekLabel(weekKey)}. Notifications sent to submitters and approvers via Azure AD.`,
    });
  };

  const screens: Record<ViewId, JSX.Element> = {
    dashboard: <Dashboard onOpenModal={setModal} onOpenSubmission={openSubmission} />,
    analystHome: (
      <AnalystHome user={user} onOpenSubmission={openSubmission} onNavigate={navigate} />
    ),
    cycles: <Cycles onOpenModal={setModal} />,
    submission: (
      <Submission
        key={submissionTarget ? JSON.stringify(submissionTarget) : 'default'}
        initial={submissionTarget ?? undefined}
        allowedEntities={scopedEntities}
        // Treasury oversees; it does not author a country's numbers. Editing
        // someone else's submitted forecast, with no save button and no trace,
        // silently moved the group total nobody could then explain.
        readOnly={!permissions.canSubmitForecasts || permissions.canViewTreasuryDashboard}
        canRequestComments={permissions.canRequestCommentary}
        // Approvers decide on the forecast itself. Treasury does not decide
        // at all: it reads and asks questions.
        canApprove={permissions.canApproveForecasts && !permissions.canViewTreasuryDashboard}
        isTreasury={permissions.canViewTreasuryDashboard}
      />
    ),
    // Treasury reviews the QUESTIONS it and the approvers have asked — not
    // every comment ever written on a forecast, which is the submitters' own
    // commentary and belongs beside the numbers it explains. Analysts keep
    // the comments view: on their own forecasts, that IS the conversation.
    review: permissions.canReviewComments ? (
      <QuestionsReview onOpenSubmission={openSubmission} scopeEntities={scopedEntities} />
    ) : (
      <CommentsReview
        onOpenSubmission={openSubmission}
        scopeEntities={scopedEntities}
        canExplain={permissions.canSubmitForecasts}
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
