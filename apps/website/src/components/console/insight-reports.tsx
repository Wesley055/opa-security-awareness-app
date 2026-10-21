"use client";
import { label } from "@/lib/labels";
import { useEffect, useRef, useState } from "react";
import { viewerSessionFetch } from "@/lib/viewer-session-fetch";
type Transport = (path: string, init?: RequestInit) => Promise<Response>;
type Finding = {
  control: string;
  status: string;
  explanation: string;
  evidenceReferences: string[];
  thresholdSeconds: number | null;
  observedSeconds: number | null;
};
type Assessment = {
  policy: { version: number; reference: string; effectiveAt: string } | null;
  evidenceCutoff: string;
  findings: Finding[];
  uncertainty: string[];
};
type Report = {
  reportId: string;
  version: number;
  sourceDigest: string;
  sourceFactCutoff: string;
  generatedAt: string;
  supersedesId: string | null;
  review?: { status: string; reference?: string };
  document: {
    summary: string;
    compliance?: Assessment;
    timeline: {
      reference: string;
      type: string;
      occurredAt: string;
      source: string;
      classification: string;
    }[];
    evidence: { reference: string; type: string; status: string }[];
    uncertainty: string[];
  };
};
type Action = {
  correctiveActionId: string;
  title: string;
  status: string;
  version: number;
  assignedToMe: boolean;
  dueAt: string;
  overdue: boolean;
  completionEvidenceId: string | null;
};
type Detail = {
  incidentId: string;
  report: Report | null;
  assessment: Assessment;
  reportVersions: {
    reportId: string;
    version: number;
    supersedesId: string | null;
  }[];
  correctiveActions: Action[];
  governance: {
    explanation: string;
    controls?: { control: string; status: string; explanation: string }[];
    identityAccess?: {
      reference: string;
      actor: string;
      authorityGrantReference: string | null;
      identifierReference: string;
      reason: string;
      timestamp: string;
    }[];
    events: {
      reference: string;
      action: string;
      actorRole: string;
      authority: string | null;
      reason: string | null;
      timestamp: string;
    }[];
  };
};
type Item = {
  incidentId: string;
  status: string;
  createdAt: string;
  generationStatus: string;
  report: { reportId: string; version: number } | null;
};

export function InsightReports({
  from,
  to,
  facilityId,
  transport,
}: {
  from: string;
  to: string;
  facilityId?: string;
  transport?: Transport;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [report, setReport] = useState<Report | null>(null);
  const [canReview, setCanReview] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      "Load facility incident reports and compliance evidence.",
    );
  const generation = useRef(0);
  const pendingKeys = useRef(new Map<string, string>());
  function requestKey(payload: unknown) {
    const fingerprint = JSON.stringify(payload);
    if (!pendingKeys.current.has(fingerprint))
      pendingKeys.current.set(fingerprint, crypto.randomUUID());
    return pendingKeys.current.get(fingerprint)!;
  }
  const inputClass = "block rounded border border-line bg-panel p-2";
  const buttonClass =
    "min-h-11 rounded border border-line px-3 disabled:opacity-50";
  useEffect(() => {
    const lifecycle = generation;
    const clear = () => {
      lifecycle.current++;
      setItems([]);
      setDetail(null);
      setReport(null);
      setCanReview(false);
      setBusy(false);
      setMessage("Evidence cleared. Reload to revalidate authority.");
    };
    const visible = () => {
      if (!document.hidden) clear();
    };
    clear();
    window.addEventListener("opa:access-changed", clear);
    window.addEventListener("opa-institutional-authority-lost", clear);
    window.addEventListener("focus", visible);
    window.addEventListener("pageshow", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      lifecycle.current++;
      window.removeEventListener("opa:access-changed", clear);
      window.removeEventListener("opa-institutional-authority-lost", clear);
      window.removeEventListener("focus", visible);
      window.removeEventListener("pageshow", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [from, to, facilityId, transport]);
  function request(op: string, id?: string, body?: unknown) {
    const query = new URLSearchParams({ op });
    if (facilityId) query.set("facilityId", facilityId);
    if (id) query.set("id", id);
    if (op === "list") {
      query.set("from", from + "T00:00:00.000Z");
      query.set("to", to + "T00:00:00.000Z");
    }
    const init: RequestInit = {
      cache: "no-store",
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    };
    return transport
      ? transport("insight?" + query, init)
      : viewerSessionFetch("/api/operator/insight?" + query, init);
  }
  async function run(task: (current: number) => Promise<void>) {
    const current = ++generation.current;
    setBusy(true);
    setMessage("Loading authorized evidence…");
    try {
      await task(current);
      if (generation.current === current)
        setMessage("Evidence loaded. Missing evidence remains uncertain.");
    } catch {
      if (generation.current === current) {
        setDetail(null);
        setReport(null);
        setItems([]);
        setCanReview(false);
        setMessage(
          "Request unavailable or access changed. Narrow the window if needed. Reload before retrying an uncertain change.",
        );
      }
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  async function data(op: string, id?: string, body?: unknown) {
    const response = await request(op, id, body);
    if (!response.ok) throw Error("Reporting unavailable");
    return response.json();
  }
  async function openIncident(id: string, current: number) {
    const next: Detail = await data("detail", id);
    const air: Report | null = next.report
      ? await data("version", next.report.reportId)
      : null;
    if (generation.current === current) {
      setDetail(next);
      setReport(air);
    }
  }
  const assessment = report?.document.compliance ?? detail?.assessment;
  return (
    <section className="mt-6 rounded-xl border border-line bg-panel p-5">
      <h2 className="text-xl font-bold">OPA Insight &amp; OPA Report</h2>
      <p>
        Facility policy controls, immutable incident reports and
        corrective-action accountability. No institutional compliance
        certification.
      </p>
      <button
        className={buttonClass}
        disabled={busy}
        onClick={() =>
          void run(async (current) => {
            setDetail(null);
            setReport(null);
            const list = await data("list");
            if (generation.current === current) {
              setItems(list.incidents);
              setCanReview(list.canReview);
            }
          })
        }
      >
        Load incident reports
      </button>
      <p role="status">{message}</p>
      <ul>
        {items.map((item) => (
          <li key={item.incidentId} className="my-3">
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void run((current) => openIncident(item.incidentId, current))
              }
            >
              Incident {item.incidentId} · {item.status} ·{" "}
              {label(item.generationStatus)}
              {item.report ? ` · AIR v${item.report.version}` : ""}
            </button>
          </li>
        ))}
      </ul>
      {detail && (
        <article className="mt-5 space-y-4">
          <h3 className="text-lg font-bold">Incident {detail.incidentId}</h3>
          <button
            disabled={busy}
            className={buttonClass}
            onClick={() =>
              void run(async (current) => {
                await data("generate", detail.incidentId, {
                  requestKey: requestKey({
                    incidentId: detail.incidentId,
                    digest: report?.sourceDigest ?? null,
                  }),
                });
                await openIncident(detail.incidentId, current);
              })
            }
          >
            Generate deterministic evidence snapshot
          </button>
          {assessment && (
            <section>
              <h4 className="font-bold">Response-policy control findings</h4>
              {report && !report.document.compliance && (
                <p>
                  This is a current evidence assessment; the selected legacy AIR
                  has no stored control assessment.
                </p>
              )}
              <p>
                {assessment.policy
                  ? `Applicable policy v${assessment.policy.version} · effective ${assessment.policy.effectiveAt} · reference ${assessment.policy.reference}`
                  : "Applicable historical policy unavailable. Timing controls are indeterminate."}
              </p>
              <p>Evidence cutoff: {assessment.evidenceCutoff}</p>
              <ul>
                {assessment.findings.map((f) => (
                  <li className="my-3" key={f.control}>
                    <strong>
                      {label(f.control)}:{" "}
                      {label(f.status)}
                    </strong>
                    <p>{f.explanation}</p>
                    <p>
                      Threshold: {f.thresholdSeconds ?? "unknown"} seconds ·
                      Recorded interval: {f.observedSeconds ?? "unknown"}{" "}
                      seconds
                    </p>
                    <p className="break-all text-sm">
                      Evidence:{" "}
                      {f.evidenceReferences.join(", ") || "unavailable"}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {report ? (
            <section>
              <h4 className="font-bold">
                AIR v{report.version} ·{" "}
                {report.review?.status ?? "REVIEW REQUIRED"}
              </h4>
              <p>
                Generated {report.generatedAt} · Snapshot cutoff{" "}
                {report.sourceFactCutoff}
              </p>
              <p className="break-all">Source digest: {report.sourceDigest}</p>
              <p>Supersedes: {report.supersedesId ?? "initial report"}</p>
              <label>
                Version history
                <select
                  className={inputClass}
                  value={report.reportId}
                  disabled={busy}
                  onChange={(e) => {
                    const id = e.target.value;
                    void run(async (current) => {
                      const air = await data("version", id);
                      if (generation.current === current) setReport(air);
                    });
                  }}
                >
                  {detail.reportVersions.map((v) => (
                    <option key={v.reportId} value={v.reportId}>
                      AIR v{v.version}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                AI-assisted narrative: unavailable — no approved provider
                configured. Deterministic evidence report available. Authorized
                human review is required before authoritative or external
                publication.
              </p>
              <p>{report.document.summary}</p>
              <h4 className="font-bold">Timeline and provenance</h4>
              <ol>
                {report.document.timeline.map((e) => (
                  <li key={e.reference}>
                    {e.occurredAt} · {e.type} · {e.source} · {e.classification}
                    <p className="break-all text-sm">{e.reference}</p>
                  </li>
                ))}
              </ol>
              <h4 className="font-bold">Evidence</h4>
              <ul>
                {report.document.evidence.map((e) => (
                  <li key={e.reference}>
                    {e.type} · {e.status} · {e.reference}
                  </li>
                ))}
              </ul>
              <h4 className="font-bold">Uncertainty</h4>
              <ul>
                {report.document.uncertainty.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <button
                disabled={busy}
                className={buttonClass}
                onClick={() =>
                  void run(async (current) => {
                    const response = await request("export", report.reportId);
                    if (!response.ok) throw Error("Export unavailable");
                    const blob = await response.blob();
                    if (generation.current !== current) return;
                    const url = URL.createObjectURL(blob),
                      a = document.createElement("a");
                    a.href = url;
                    a.download = `opa-air-v${report.version}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  })
                }
              >
                Export snapshot JSON
              </button>
              {canReview && report.review?.status !== "APPROVED" && (
                <button
                  disabled={busy}
                  className={buttonClass}
                  onClick={() =>
                    void run(async (current) => {
                      await data("approve", report.reportId, {
                        sourceDigest: report.sourceDigest,
                      });
                      const air = await data("version", report.reportId);
                      if (generation.current === current) setReport(air);
                    })
                  }
                >
                  Approve reviewed snapshot
                </button>
              )}
            </section>
          ) : (
            <p>
              No AIR snapshot yet. A matching authoritative resolution event is
              required for automatic generation.
            </p>
          )}
          <section>
            <h4 className="font-bold">Corrective actions</h4>
            {detail.correctiveActions.map((action) => (
              <div className="my-3" key={action.correctiveActionId}>
                <p>
                  {action.title} · {action.status} · due {action.dueAt}
                  {action.overdue ? " · overdue" : ""} · revision{" "}
                  {action.version}
                </p>
                {action.assignedToMe &&
                  ["OPEN", "COMPLETED"].includes(action.status) && (
                    <button
                      className={buttonClass}
                      disabled={busy}
                      onClick={() =>
                        void run(async (current) => {
                          await data(
                            "update-action",
                            action.correctiveActionId,
                            {
                              expectedVersion: action.version,
                              status: "IN_PROGRESS",
                            },
                          );
                          await openIncident(detail.incidentId, current);
                        })
                      }
                    >
                      {action.status === "OPEN" ? "Start work" : "Reopen work"}
                    </button>
                  )}
                {action.assignedToMe && action.status === "IN_PROGRESS" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const values = new FormData(e.currentTarget);
                      void run(async (current) => {
                        await data("update-action", action.correctiveActionId, {
                          expectedVersion: action.version,
                          status: "COMPLETED",
                          completionEvidenceId: values.get("evidence"),
                        });
                        await openIncident(detail.incidentId, current);
                      });
                    }}
                  >
                    <label>
                      Stored completion evidence ID
                      <input required name="evidence" className={inputClass} />
                    </label>
                    <button className={buttonClass} disabled={busy}>
                      Complete with evidence
                    </button>
                  </form>
                )}
                {canReview &&
                  action.status === "COMPLETED" &&
                  !action.assignedToMe && (
                    <button
                      className={buttonClass}
                      disabled={busy}
                      onClick={() =>
                        void run(async (current) => {
                          await data(
                            "update-action",
                            action.correctiveActionId,
                            {
                              expectedVersion: action.version,
                              status: "VERIFIED",
                            },
                          );
                          await openIncident(detail.incidentId, current);
                        })
                      }
                    >
                      Independently verify evidence
                    </button>
                  )}
                {canReview &&
                  ["OPEN", "IN_PROGRESS"].includes(action.status) && (
                    <button
                      className={buttonClass}
                      disabled={busy}
                      onClick={() =>
                        void run(async (current) => {
                          await data(
                            "update-action",
                            action.correctiveActionId,
                            {
                              expectedVersion: action.version,
                              status: "CANCELLED",
                            },
                          );
                          await openIncident(detail.incidentId, current);
                        })
                      }
                    >
                      Cancel action
                    </button>
                  )}
              </div>
            ))}
            {canReview && report && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const values = new FormData(e.currentTarget);
                  void run(async (current) => {
                    const payload = {
                      airId: report.reportId,
                      ownerId: values.get("owner"),
                      dueAt: new Date(String(values.get("due"))).toISOString(),
                      category: values.get("category"),
                      priority: values.get("priority"),
                    };
                    await data("create-action", undefined, {
                      ...payload,
                      requestKey: requestKey(payload),
                    });
                    await openIncident(detail.incidentId, current);
                  });
                }}
              >
                <h5>Create corrective action</h5>
                <label>
                  Facility owner ID
                  <input required name="owner" className={inputClass} />
                </label>
                <label>
                  Due (local time)
                  <input
                    required
                    type="datetime-local"
                    name="due"
                    className={inputClass}
                  />
                </label>
                <label>
                  Category
                  <select name="category" className={inputClass}>
                    {[
                      "RESPONSE_REVIEW",
                      "EVIDENCE_REVIEW",
                      "DELIVERY_REVIEW",
                      "PROCEDURE_REVIEW",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select name="priority" className={inputClass}>
                    {["LOW", "MEDIUM", "HIGH", "URGENT"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <button className={buttonClass} disabled={busy}>
                  Create action
                </button>
              </form>
            )}
          </section>
          <section>
            <h4 className="font-bold">
              Access governance and audit uncertainty
            </h4>
            <p>{detail.governance.explanation}</p>
            <ul>
              {detail.governance.controls?.map((c) => (
                <li key={c.control}>
                  {label(c.control)}: {label(c.status)}
                  <p>{c.explanation}</p>
                </li>
              ))}
            </ul>
            <h5>Incident-linked protected identity access</h5>
            <ul>
              {detail.governance.identityAccess?.map((e) => (
                <li key={e.reference}>
                  {e.timestamp} · {e.actor} · reason {e.reason} · grant{" "}
                  {e.authorityGrantReference ?? "not recorded"}
                  <p className="break-all text-sm">
                    Audit reference {e.reference} · snapshot{" "}
                    {e.identifierReference}
                  </p>
                </li>
              ))}
            </ul>
            <ul>
              {detail.governance.events.map((e) => (
                <li key={e.reference}>
                  {e.timestamp} · {e.action} · actor [protected] ({e.actorRole})
                  · authority {e.authority ?? "not recorded"} · reason{" "}
                  {e.reason ?? "not recorded"}
                  <p className="break-all text-sm">
                    Audit reference {e.reference}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </article>
      )}
    </section>
  );
}
