"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { institutionalFetch } from "./institutional-fetch";
export type InstitutionalContext = {
  actor: { id: string; role: string; name?: string };
  globalCapabilities?: string[];
  elevations?: Array<{
    id: string;
    facilityId: string;
    supportCaseId: string;
    capability: string;
    startsAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }>;
  facilities: Array<{ id: string; name: string; capabilities: string[] }>;
};
export function useInstitutionalContext() {
  const [context, setContext] = useState<InstitutionalContext | null>(null),
    [state, setState] = useState("INITIAL_LOADING"),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState("Checking current authority…");
  const generation = useRef(0),
    contextRef = useRef<InstitutionalContext | null>(null),
    pending = useRef(false),
    controller = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const expire = useCallback(() => {
    setConfirmed(false);
    generation.current++;
    controller.current?.abort();
    pending.current = false;
    contextRef.current = null;
    setContext(null);
    setState("AUTHORITY_EXPIRED");
    setMessage("Your authority could not be confirmed. Sign in again.");
  }, []);
  const refresh = useCallback(
    async (foreground = false) => {
      if (foreground && !contextRef.current)
        setMessage("Checking current authority…");
      if (pending.current) return;
      pending.current = true;
      const current = generation.current;
      const abort = new AbortController();
      controller.current = abort;
      if (!contextRef.current) setState("INITIAL_LOADING");
      try {
        const response = await institutionalFetch("context", {
          signal: abort.signal,
        });
        if (!response.ok) {
          if ([401, 403].includes(response.status)) {
            if (mounted.current && current === generation.current) expire();
            return;
          }
          throw Error();
        }
        const next = (await response.json()) as InstitutionalContext;
        if (!mounted.current || current !== generation.current) return;
        if (!next.actor?.id || !Array.isArray(next.facilities)) throw Error();
        setConfirmed(true);
        contextRef.current = next;
        setContext((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        );
        setState("READY");
        setMessage("");
      } catch {
        if (mounted.current && current === generation.current) {
          setConfirmed(false);
          setState("READ_UNAVAILABLE");
          setMessage(
            "Current authority could not be revalidated. Actions are paused; retry without discarding your draft.",
          );
        }
      } finally {
        if (controller.current === abort) pending.current = false;
      }
    },
    [expire],
  );
  useEffect(() => {
    mounted.current = true;
    const focus = () => {
        if (contextRef.current) void refresh(true);
      },
      lost = () => expire(),
      storage = (e: StorageEvent) => {
        if (e.key === "opa-institutional-session") {
          expire();
          void refresh(true);
        }
      },
      visibility = () => {
        if (document.visibilityState === "visible") focus();
      };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", focus);
    window.addEventListener("storage", storage);
    window.addEventListener("opa-institutional-authority-lost", lost);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => {
      if (contextRef.current && document.visibilityState !== "hidden")
        void refresh();
    }, 5000);
    // Start the initial external read after the effect is installed. A cleaned-up
    // StrictMode mount must not start a second request or publish state.
    let disposed = false;
    void Promise.resolve().then(() => {
      if (!disposed) return refresh();
    });
    const invalidate = () => {
      disposed = true;
      generation.current++;
    };
    return () => {
      mounted.current = false;
      invalidate();
      controller.current?.abort();
      pending.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", focus);
      window.removeEventListener("storage", storage);
      window.removeEventListener("opa-institutional-authority-lost", lost);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh, expire]);
  return {
    context,
    state,
    message,
    refresh,
    expire,
    canMutate:
      confirmed && (state === "READY" || state === "BACKGROUND_REFRESHING"),
  };
}
