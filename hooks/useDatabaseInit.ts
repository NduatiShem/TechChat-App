import { initDatabaseReady } from '@/services/database';
import { useEffect, useState } from 'react';

/** Returns true only when local SQLite (including outbox schema) is ready for writes. */
export function useDatabaseInit(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    initDatabaseReady().then((ok) => {
      if (mounted) {
        setReady(ok);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return ready;
}
