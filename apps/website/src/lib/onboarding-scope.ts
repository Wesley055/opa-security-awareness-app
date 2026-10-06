"use client";
import { useEffect, useRef, useState } from "react";
import { onboardingFetch } from "@/lib/onboarding-fetch";
export type Scope = {
  actor: { id: string; role: string };
  facilities: { id: string; name: string }[];
};
export function signalOnboardingSession() {
  window.dispatchEvent(new Event("opa-onboarding-session"));
  try {
    localStorage.setItem("opa-onboarding-session", crypto.randomUUID());
  } catch {
    /* Focus and periodic checks still revalidate when storage is unavailable. */
  }
}
export function useOnboardingScope() {
  const [scope, setScope] = useState<Scope | null>(null);
  const [error, setError] = useState("Checking current authority…");
  const revision = useRef(0);
  const refresh = useRef<() => void>(() => {});
  const invalidate = () => {
    ++revision.current;
    setScope(null);
    setError(
      "Current authority could not be confirmed. Restore your session or retry.",
    );
  };
  useEffect(() => {
    let alive = true,
      pending = 0;
    async function revalidate(clear = false) {
      ++pending;
      const version = ++revision.current;
      if (clear) setScope(null);
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 10000);
      try {
        let cursor: string | null = null,
          result: Scope | null = null;
        const seen = new Set<string>();
        const collected: Scope["facilities"] = [];
        do {
          const response = await onboardingFetch(
            "facilities" + (cursor ? "?cursor=" + cursor : ""),
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error();
          const data = await response.json();
          if (
            !data.actor?.id ||
            !data.actor?.role ||
            !Array.isArray(data.facilities)
          )
            throw new Error();
          if (
            result &&
            (result.actor.id !== data.actor.id ||
              result.actor.role !== data.actor.role)
          )
            throw new Error();
          collected.push(...data.facilities);
          result = { actor: data.actor, facilities: collected };
          cursor = data.nextCursor ?? null;
          if (cursor && seen.has(cursor)) throw new Error();
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (alive && version === revision.current) {
          setScope(result);
          setError("");
        }
      } catch {
        if (alive && version === revision.current) {
          setScope(null);
          setError(
            "Current authority could not be confirmed. Restore your session or retry.",
          );
        }
      } finally {
        clearTimeout(deadline);
        --pending;
      }
    }
    const reset = () => {
      void revalidate(true);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        ++revision.current;
        setScope(null);
      } else reset();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "opa-onboarding-session") reset();
    };
    refresh.current = reset;
    window.addEventListener("focus", reset);
    window.addEventListener("pageshow", reset);
    window.addEventListener("storage", storage);
    window.addEventListener("opa-onboarding-session", reset);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden" && !pending) void revalidate();
    }, 5000);
    void revalidate();
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", reset);
      window.removeEventListener("pageshow", reset);
      window.removeEventListener("storage", storage);
      window.removeEventListener("opa-onboarding-session", reset);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return { scope, error, invalidate, retry: () => refresh.current() };
}
