import { useSyncExternalStore } from 'react';
import { dataRevision, subscribeToData } from '../storage/localStorage';

/**
 * Re-render when anything in the persistence layer changes.
 *
 * Screens read from storage during render and memoise on their own local
 * counters, which leaves one panel showing stale data when a sibling writes.
 * Depending on this value instead ties every reader to the same revision, so
 * an approval, a submission or a comment request refreshes the whole screen at
 * once rather than only the component that happened to trigger it.
 */
export function useDataVersion(): number {
  return useSyncExternalStore(subscribeToData, dataRevision, dataRevision);
}
