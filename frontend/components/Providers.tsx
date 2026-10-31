"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { loadSession, saveSession, type Session } from "@/lib/api";

interface Toast {
  id: number;
  text: string;
  kind: "ok" | "error";
}

interface Ctx {
  session: Session | null;
  ready: boolean;
  setSession: (s: Session | null) => void;
  toast: (text: string, kind?: "ok" | "error") => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function Providers({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const sync = () => setSessionState(loadSession());
    sync();
    setReady(true);
    window.addEventListener("slotzero-session", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("slotzero-session", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setSession = useCallback((s: Session | null) => {
    saveSession(s);
    setSessionState(s);
  }, []);

  const toast = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <AppCtx.Provider value={{ session, ready, setSession, toast }}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp must be used inside <Providers>");
  return c;
}
