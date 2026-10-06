"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { superAdminFetch } from "@/lib/super-admin-fetch";
import { ConsoleIdentity } from "./identity";
import SignOut from "@/app/(console)/super-admin/sign-out";
type Identity = { id: string; name: string; role: string };
export function PlatformSession({
  initial,
  children,
}: {
  initial: Identity;
  children: ReactNode;
}) {
  const router = useRouter();
  const [identity, setIdentity] = useState<Identity | null>(initial);
  const [notice, setNotice] = useState("");
  const [initialId, setInitialId] = useState(initial.id);
  if (initialId !== initial.id) {
    setInitialId(initial.id);
    setIdentity(initial);
    setNotice("");
  }
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false,
      pending = false;
    let controller: AbortController | undefined;
    const lost = () => {
      generation.current++;
      controller?.abort();
      pending = false;
      setIdentity(null);
      setNotice("Current platform authority is required. Sign in again.");
    };
    const read = async () => {
      if (disposed || pending) return;
      pending = true;
      const version = generation.current;
      const abort = new AbortController();
      controller = abort;
      try {
        const response = await superAdminFetch("context", {
          signal: abort.signal,
        });
        if (disposed || version !== generation.current) return;
        if ([401, 403].includes(response.status)) {
          lost();
          return;
        }
        if (!response.ok) throw Error();
        const next = (await response.json()) as Identity;
        if (disposed || version !== generation.current) return;
        if (
          !next.id ||
          next.role !== "ADMIN" ||
          typeof next.name !== "string"
        ) {
          lost();
          return;
        }
        if (next.id !== initial.id) {
          setIdentity(null);
          setNotice("Account changed. Loading current platform context…");
          router.refresh();
          return;
        }
        setIdentity((previous) =>
          previous?.name === next.name && previous.id === next.id
            ? previous
            : next,
        );
        setNotice("");
      } catch {
        if (!disposed && version === generation.current)
          setNotice(
            "Session validation is temporarily unavailable. Retry when the service returns.",
          );
      } finally {
        if (controller === abort) pending = false;
      }
    };
    const visible = () => {
      if (document.visibilityState !== "hidden") void read();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "opa-super-admin-session") {
        lost();
        void read();
      }
    };
    window.addEventListener("opa-super-admin-authority-lost", lost);
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", storage);
    const timer = setInterval(visible, 15000);
    const invalidate = () => {
      generation.current++;
    };
    return () => {
      disposed = true;
      invalidate();
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("opa-super-admin-authority-lost", lost);
      window.removeEventListener("focus", visible);
      window.removeEventListener("pageshow", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", storage);
    };
  }, [initial.id, router]);
  if (!identity)
    return (
      <main className="sa-body">
        <p role="alert">{notice}</p>
        <a href="/super-admin/login">Sign in</a>
      </main>
    );
  return (
    <>
      <header className="sa-header">
        <a href="/super-admin" className="sa-brand">
          OPA / Platform Governance
        </a>
        <ConsoleIdentity
          name={identity.name}
          role={identity.role}
          scope="Platform governance"
        />
        <SignOut />
      </header>
      {notice && <p role="status">{notice}</p>}
      <div key={identity.id}>{children}</div>
    </>
  );
}
