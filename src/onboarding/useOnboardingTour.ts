import { useCallback, useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { tourFor, type TourStep } from './tourSteps';
import { loadData, saveData } from '../storage/localStorage';
import type { User } from '../types';
import type { ViewId } from '../types/nav';

// ============================================================================
// The onboarding walkthrough.
//
// driver.js drives the highlighting; everything app-specific lives here:
// which screen a step belongs to, waiting for that screen to render, and
// skipping steps whose element never turns up (a conditionally hidden
// feature, a narrow screen, a role variation). Step CONTENT is in
// tourSteps.ts — this file never mentions a role.
// ============================================================================

/** Per-user completion flag, so a tour is shown once per person. */
const seenKey = (email: string) => `onboarding:seen:${email.toLowerCase()}`;

export function hasSeenTour(email: string): boolean {
  return loadData<boolean>(seenKey(email), false) === true;
}

export function markTourSeen(email: string): void {
  saveData(seenKey(email), true);
}

/** Invite links carry ?welcome=1, which forces the tour on first arrival. */
export const WELCOME_PARAM = 'welcome';

function invitedViaEmail(): boolean {
  try {
    return new URLSearchParams(window.location.search).get(WELCOME_PARAM) === '1';
  } catch {
    return false;
  }
}

/** Drop the welcome flag so a refresh doesn't restart the tour. */
function clearWelcomeParam(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(WELCOME_PARAM)) return;
    url.searchParams.delete(WELCOME_PARAM);
    window.history.replaceState({}, '', url.toString());
  } catch {
    /* history is unavailable in some embedded contexts — harmless */
  }
}

/** Resolve a selector, retrying across a few frames while React renders. */
function waitForElement(selector: string, timeoutMs = 900): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }
    const started = Date.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) resolve(el);
      else if (Date.now() - started > timeoutMs) resolve(null);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

interface TourOptions {
  user: User;
  /** Switch screens between steps. */
  onNavigate: (view: ViewId) => void;
  /** Whether the app is ready (screens mounted) for the tour to start. */
  enabled?: boolean;
}

export interface TourController {
  /** Start (or restart) the walkthrough for the current user. */
  replay: () => void;
}

export function useOnboardingTour({
  user,
  onNavigate,
  enabled = true,
}: TourOptions): TourController {
  const driverRef = useRef<Driver | null>(null);
  const startedForRef = useRef<string | null>(null);
  // Keep the latest navigate callback without restarting the tour.
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  const run = useCallback(
    async (steps: TourStep[]) => {
      driverRef.current?.destroy();

      /**
       * Prepare one step: move to its screen, then wait for the element.
       * Returns false when the element never appears, so the caller can skip.
       */
      const prepare = async (step: TourStep): Promise<boolean> => {
        if (step.view) {
          navigateRef.current(step.view);
          // Let React commit the new screen before we look for the element.
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        if (!step.selector) return true; // centred card, nothing to find
        return (await waitForElement(step.selector)) !== null;
      };

      /** First usable step at or after `from`, walking in `dir`. */
      const findUsable = async (from: number, dir: 1 | -1): Promise<number> => {
        for (let i = from; i >= 0 && i < steps.length; i += dir) {
          if (await prepare(steps[i])) return i;
        }
        return -1;
      };

      const instance = driver({
        showProgress: true,
        allowClose: true,
        overlayOpacity: 0.55,
        stagePadding: 6,
        stageRadius: 8,
        popoverClass: 'liquid-tour',
        nextBtnText: 'Next',
        prevBtnText: 'Back',
        doneBtnText: 'Finish',
        progressText: 'Step {{current}} of {{total}}',
        steps: steps.map((step) => ({
          element: step.selector,
          popover: {
            title: step.title,
            description: step.body,
            side: step.side ?? 'bottom',
            align: 'start',
            // Taking over the buttons lets us navigate screens and skip
            // steps whose element isn't on this page.
            onNextClick: async () => {
              const target = await findUsable(instance.getActiveIndex()! + 1, 1);
              if (target === -1) instance.destroy();
              else instance.moveTo(target);
            },
            onPrevClick: async () => {
              const target = await findUsable(instance.getActiveIndex()! - 1, -1);
              if (target !== -1) instance.moveTo(target);
            },
          },
        })),
        onDestroyed: () => {
          markTourSeen(user.email);
          driverRef.current = null;
        },
      });

      driverRef.current = instance;
      const first = await findUsable(0, 1);
      if (first === -1) {
        // Nothing to show (very unusual) — don't nag the user again.
        markTourSeen(user.email);
        driverRef.current = null;
        return;
      }
      instance.drive(first);
    },
    [user.email],
  );

  const replay = useCallback(() => {
    void run(tourFor(user.role, user.name.split(' ')[0] ?? 'there'));
  }, [run, user.role, user.name]);

  // Auto-start once per user: on first sign-in, or whenever an invite link
  // carries ?welcome=1.
  useEffect(() => {
    if (!enabled) return;
    if (startedForRef.current === user.email) return;
    startedForRef.current = user.email;

    const invited = invitedViaEmail();
    // Demo joiners always replay so every role's tour stays reviewable.
    if (!invited && !user.alwaysTour && hasSeenTour(user.email)) return;
    clearWelcomeParam();

    // Wait for the landing screen to settle before highlighting anything.
    const id = setTimeout(replay, 450);
    return () => clearTimeout(id);
  }, [enabled, user.email, user.alwaysTour, replay]);

  // Tear the tour down if the component unmounts mid-walkthrough.
  useEffect(() => () => driverRef.current?.destroy(), []);

  return { replay };
}
