import { useEffect, useState } from 'react';
import { authFilesApi } from '@/services/api';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import { countCredentialsByProvider, type ConnectedCounts } from '../connectedCounts';

/**
 * Per-provider credential counts for the "N connected" column.
 *
 * Loads once per connection and reloads when a sign-in or import adds a credential.
 * Counts are decoration: a failed load leaves them `null` (or at the last known value)
 * and the picker simply omits them.
 */
export function useConnectedCounts(apiBase: string): ConnectedCounts | null {
  const [counts, setCounts] = useState<ConnectedCounts | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      authFilesApi
        .list()
        .then((response) => {
          if (!cancelled) setCounts(countCredentialsByProvider(response.files));
        })
        .catch(() => {
          // Keep the last known counts; the column is optional.
        });
    };
    load();
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_FILES_CHANGED_EVENT, load);
    };
  }, [apiBase]);

  return counts;
}
