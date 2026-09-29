import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import * as api from './api';

// Count of not-yet-accepted ("Qabul qilindi") clearances, shared between the
// sidebar badge and the Cleared page so both stay in sync. Polled while the tab
// is visible; the Cleared page also calls refresh() right after it mutates.
interface ClearedNotifications {
  clearedUnack: number;
  refreshCleared: () => void;
}

const Ctx = createContext<ClearedNotifications>({ clearedUnack: 0, refreshCleared: () => {} });

export function ClearedNotificationsProvider({ children }: { children: ReactNode }) {
  const [clearedUnack, setCount] = useState(0);

  const refreshCleared = useCallback(() => {
    api.clearedUnacknowledgedCount().then(setCount).catch(() => { /* ignore transient errors */ });
  }, []);

  useEffect(() => {
    refreshCleared();
    const id = window.setInterval(() => { if (!document.hidden) refreshCleared(); }, 60000);
    return () => window.clearInterval(id);
  }, [refreshCleared]);

  return <Ctx.Provider value={{ clearedUnack, refreshCleared }}>{children}</Ctx.Provider>;
}

export function useClearedNotifications(): ClearedNotifications {
  return useContext(Ctx);
}
