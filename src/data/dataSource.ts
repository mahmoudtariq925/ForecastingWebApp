// ============================================================================
// Build-time data source switch.
//
// One codebase, two deployable instances:
//   static (default) — the demo: seeded mock data, deployed to the existing
//                      GitHub Pages root. Untouched by anything live-related.
//   live             — starts empty: a bootstrap administrator, no entities,
//                      no demo numbers. Populated through Legal Entity Setup,
//                      User Management and the Data Import screen, and
//                      deployed separately under /live/.
//
// The mode is fixed at BUILD time via VITE_DATA_SOURCE (see .env.live), so a
// deployed instance can never drift into the other mode at runtime — which is
// also what keeps demo data and real data from ever mixing. When the Phase 2
// backend arrives it attaches to the live build: the API base URL becomes a
// sibling env var here and the storage layer swaps localStorage for fetch.
// ============================================================================

export type DataSource = 'static' | 'live';

export const DATA_SOURCE: DataSource =
  import.meta.env.VITE_DATA_SOURCE === 'live' ? 'live' : 'static';

export const IS_LIVE = DATA_SOURCE === 'live';

/** Whether screens may fabricate demo values for data nobody entered. */
export const DEMO_DATA = !IS_LIVE;
