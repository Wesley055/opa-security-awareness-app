"use client";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";
import {
  parseSafeWalkProtection,
  type SafeWalkProtectionData,
} from "@/lib/safewalk-protection";
const labels: Record<string, string> = {
  RECEIVING: "Recent emergency-location receipt",
  SILENT: "Emergency location stream stale",
  AWAITING_FIRST_FIX: "No emergency-period location received",
  ENDED: "Emergency tracking ended",
  OPERATOR_SEEN: "Seen",
  OPERATOR_ACKNOWLEDGED: "Acknowledged",
  OPERATOR_DISPATCHED: "Dispatched",
  OPERATOR_RESPONSE_PROGRESS: "Progress recorded",
  OPERATOR_ESCALATION: "Escalation recorded",
};
export function SafeWalkProtection({
  endpoint = "/api/operator/safewalk",
  transport = viewerSessionFetch,
  incidentLinks = true,
}: {
  endpoint?: string;
  transport?: (path: string, init?: RequestInit) => Promise<Response>;
  incidentLinks?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<{
      endpoint: string;
      data: SafeWalkProtectionData;
    } | null>(null),
    [notice, setNotice] = useState("Loading authorized emergencies…");
  const data = snapshot?.endpoint === endpoint ? snapshot.data : null;
  useEffect(() => {
    let stopped = false,
      pending = false;
    const controllers = new Set<AbortController>();
    const stop = () => {
      stopped = true;
      for (const c of controllers) c.abort();
      setSnapshot(null);
      setNotice(
        "Emergency visibility ended. Revalidate your account and facility.",
      );
    };
    const poll = async () => {
      if (stopped || pending || document.hidden) return;
      pending = true;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const response = await transport(endpoint, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        if (stopped) return;
        if ([401, 403, 404, 409].includes(response.status)) {
          stop();
          return;
        }
        if (!response.ok) throw Error("Unavailable");
        const body = parseSafeWalkProtection(await response.json());
        if (stopped) return;
        setSnapshot({ endpoint, data: body });
        setNotice(
          body.incidents.length
            ? "Authorized emergency records."
            : "No SafeWalk-origin emergencies in this authorized facility.",
        );
      } catch {
        if (!stopped)
          setNotice(
            "Emergency service temporarily unavailable. Previous records may be stale; visibility is not confirmation of remote delivery.",
          );
      } finally {
        controllers.delete(controller);
        pending = false;
      }
    };
    const visible = () => {
      if (!document.hidden) void poll();
    };
    void poll();
    const timer = setInterval(visible, 5000);
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("opa:access-changed", stop);
    window.addEventListener("opa-institutional-authority-lost", stop);
    return () => {
      stopped = true;
      clearInterval(timer);
      for (const c of controllers) c.abort();
      window.removeEventListener("focus", visible);
      window.removeEventListener("pageshow", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("opa:access-changed", stop);
      window.removeEventListener("opa-institutional-authority-lost", stop);
    };
  }, [endpoint, transport]);
  return (
    <section
      className="mx-auto max-w-7xl space-y-4 bg-base p-4 text-ink sm:p-6"
      style={
        {
          "--color-base": "#121212",
          "--color-panel": "#1E252B",
          "--color-ink": "#FFFFFF",
        } as CSSProperties
      }
    >
      <h1 className="text-3xl font-bold">SafeWalk Protection</h1>
      <p>
        Private journeys remain private. This surface shows only explicitly
        escalated canonical emergency Incidents. Ordinary journeys and
        guardian-only overdue alerts are not shown.
      </p>
      <p role="status">{notice}</p>
      {data?.hasMore && (
        <p>
          Showing up to 100 emergency records, active first. Additional records
          exist; use the existing Incident workspace. This is not a complete
          history.
        </p>
      )}
      {data?.incidents.map((row) => (
        <article
          key={row.id}
          className="rounded-xl border border-line bg-panel p-5"
        >
          <h2 className="text-lg font-bold">SafeWalk emergency</h2>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt>Incident reference</dt>
              <dd className="break-all font-mono">{row.id}</dd>
            </div>
            <div>
              <dt>Incident status</dt>
              <dd>{row.status}</dd>
            </div>
            <div>
              <dt>Journey protection</dt>
              <dd>Escalated to emergency</dd>
            </div>
            <div>
              <dt>Emergency started</dt>
              <dd>
                <time dateTime={row.emergencyStartedAt}>
                  {row.emergencyStartedAt}
                </time>
              </dd>
            </div>
            <div>
              <dt>Acknowledgement</dt>
              <dd>
                {row.acknowledged
                  ? "Operator acknowledgement recorded"
                  : "No acknowledgement recorded"}
              </dd>
            </div>
            <div>
              <dt>Latest operational event</dt>
              <dd>
                {row.lastOperationalEvent
                  ? labels[row.lastOperationalEvent]
                  : "No operational event recorded"}
              </dd>
            </div>
            <div>
              <dt>Tracking</dt>
              <dd>{labels[row.trackingState]}</dd>
            </div>
            <div>
              <dt>Last emergency-location receipt</dt>
              <dd>{row.lastFixReceivedAt ?? "None recorded"}</dd>
            </div>
          </dl>
          {incidentLinks ? (
            <Link
              href={"/operator/incidents/" + row.id}
              className="mt-4 inline-flex min-h-11 items-center text-[#FFB300] underline"
            >
              Open Incident · existing response, tracking and Evidence
            </Link>
          ) : (
            <p className="mt-3">
              Use existing Incident controls permitted for your role. This read
              does not grant Operator response authority.
            </p>
          )}
        </article>
      ))}
      <p className="text-sm text-muted">
        Receipt timestamps describe data received by OPA. They do not prove
        current device connectivity or email/SMS delivery. Private destinations,
        routes, guardians and pre-emergency location history are excluded.
      </p>
    </section>
  );
}
