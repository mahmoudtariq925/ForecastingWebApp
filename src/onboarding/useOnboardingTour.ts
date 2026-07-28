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

/**
 * Mark the destination page in the sidebar while a step is showing, so it is
 * obvious WHERE the tour has just navigated to — not only which control it is
 * pointing at. Cleared when the tour ends.
 */
const NAV_CLASS = 'tour-nav-active';

function markNav(view?: ViewId): void {
  document.querySelectorAll(`.${NAV_CLASS}`).forEach((el) => el.classList.remove(NAV_CLASS));
  if (!view) return;
  document.querySelector(`[data-tour="nav-${view}"]`)?.classList.add(NAV_CLASS);
}

/** Nearest ancestor that actually scrolls — screens scroll inside `.content`,
 * not the window, so that box is the real viewport for a step's element. */
function scrollParent(el: Element): Element | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Bring a step's element into view before driver.js measures it. An element
 * near the bottom of a long page would otherwise be highlighted below the
 * fold with its popover pushed off-screen. Elements that fit are centred;
 * anything taller than the scrolling box is aligned to its top, which is the
 * only way its start and its popover can both be visible.
 */
/** Breathing room so the highlight ring around the element isn't clipped. */
const SCROLL_PAD = 12;

function scrollIntoView(el: Element): Promise<void> {
  const rect = el.getBoundingClientRect();
  const parent = scrollParent(el);
  const view = parent
    ? parent.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight };
  const viewHeight = view.bottom - view.top;
  const fits = rect.height <= viewHeight;
  const alreadyUsable = fits
    ? rect.top >= view.top && rect.bottom <= view.bottom
    : rect.top >= view.top && rect.top < view.top + viewHeight * 0.5;
  if (alreadyUsable) return Promise.resolve();

  if (parent) {
    // Scroll the container by an exact delta. `scrollIntoView` rounds, which
    // left tall elements a few pixels above the top edge with their highlight
    // ring clipped.
    const target = fits
      ? rect.top - view.top - (viewHeight - rect.height) / 2 // centre it
      : rect.top - view.top - SCROLL_PAD; // top-align, just below the edge
    parent.scrollTop += target;
  } else {
    el.scrollIntoView({ block: fits ? 'center' : 'start', inline: 'nearest', behavior: 'auto' });
  }
  // One frame for the scroll to land, so driver.js highlights the final spot.
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

interface TourOptions {
  user: User;
  /** Switch screens between steps. */
  onNavigate: (view: ViewId) => void;
  /**
   * Views this user can actually open. A step on any other screen is dropped
   * instantly instead of navigating to a screen the app will refuse and then
   * waiting for an element that can never appear — which left the popover
   * stranded on the previous step, unhighlighted, for about a second.
   */
  reachableViews?: Set<ViewId>;
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
  reachableViews,
  enabled = true,
}: TourOptions): TourController {
  const driverRef = useRef<Driver | null>(null);
  const startedForRef = useRef<string | null>(null);
  // Keep the latest navigate callback without restarting the tour.
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const reachableRef = useRef(reachableViews);
  reachableRef.current = reachableViews;
  // A step change is asynchronous (navigate → render → scroll). Without this
  // guard a second click during that window starts a competing transition and
  // the tour appears to skip or repeat a step.
  const movingRef = useRef(false);

  const run = useCallback(
    async (steps: TourStep[]) => {
      driverRef.current?.destroy();
      movingRef.current = false;

      /**
       * Prepare one step: move to its screen, then wait for the element.
       * Returns false when the element never appears, so the caller can skip.
       */
      const prepare = async (step: TourStep): Promise<boolean> => {
        if (step.view && reachableRef.current && !reachableRef.current.has(step.view)) {
          return false; // screen this user/build doesn't have — skip at once
        }
        if (step.view) {
          navigateRef.current(step.view);
          // Let React commit the new screen before we look for the element.
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        if (!step.selector) {
          markNav(step.view);
          return true; // centred card, nothing to find
        }
        const el = await waitForElement(step.selector);
        if (!el) return false;
        markNav(step.view);
        await scrollIntoView(el);
        return true;
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
              if (movingRef.current) return;
              movingRef.current = true;
              try {
                const target = await findUsable(instance.getActiveIndex()! + 1, 1);
                if (target === -1) instance.destroy();
                else instance.moveTo(target);
              } finally {
                movingRef.current = false;
              }
            },
            onPrevClick: async () => {
              if (movingRef.current) return;
              movingRef.current = true;
              try {
                const target = await findUsable(instance.getActiveIndex()! - 1, -1);
                if (target !== -1) instance.moveTo(target);
              } finally {
                movingRef.current = false;
              }
            },
          },
        })),
        onDestroyed: () => {
          markNav(undefined);
          markTourSeen(user.email);
          driverRef.current = null;
        },
      });

      driverRef.current = instance;
      const first = await findUsable(0, 1);
      if (first === -1) {
        // Nothing to show (very unusual) — don't nag the user again.
        markNav(undefined);
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
  useEffect(
    () => () => {
      markNav(undefined);
      driverRef.current?.destroy();
    },
    [],
  );

  return { replay };
}
