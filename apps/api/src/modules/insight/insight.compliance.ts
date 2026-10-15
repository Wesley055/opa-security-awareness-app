import type { Source } from "./insight.projection";

export type ControlStatus =
  "COMPLIANT" | "NON_COMPLIANT" | "INDETERMINATE" | "NOT_APPLICABLE";
export type PolicyEvidence = {
  version: number;
  acknowledgementSeconds: number;
  dispatchSeconds: number;
  progressSeconds: number;
  unattendedSeconds: number;
  closureSeconds: number;
  effectiveAt: string;
  reference: string;
};
export type Finding = {
  control: string;
  status: ControlStatus;
  explanation: string;
  evidenceReferences: string[];
  thresholdSeconds: number | null;
  observedSeconds: number | null;
};
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Only complete, versioned policy records can authorize a timing determination. */
export function policyEvidence(
  value: unknown,
  effectiveAt: Date,
  reference: string,
): PolicyEvidence | null {
  const p = record(value);
  const fields = [
    "version",
    "acknowledgementSeconds",
    "dispatchSeconds",
    "progressSeconds",
    "unattendedSeconds",
    "closureSeconds",
  ];
  if (
    fields.some((k) => !Number.isInteger(p[k]) || Number(p[k]) < 1) ||
    fields.slice(1).some((k) => Number(p[k]) > 604800)
  )
    return null;
  return {
    version: Number(p.version),
    acknowledgementSeconds: Number(p.acknowledgementSeconds),
    dispatchSeconds: Number(p.dispatchSeconds),
    progressSeconds: Number(p.progressSeconds),
    unattendedSeconds: Number(p.unattendedSeconds),
    closureSeconds: Number(p.closureSeconds),
    effectiveAt: effectiveAt.toISOString(),
    reference,
  };
}

/** Absence of a milestone is uncertainty, never proof that staff failed to act. */
export function assessResponse(
  source: Source,
  policy: PolicyEvidence | null,
  cutoff: Date,
) {
  const start = source.createdAt.getTime();
  const events = source.timelineEvents.filter(
    (e) =>
      e.occurredAt.getTime() >= start &&
      e.occurredAt <= cutoff &&
      e.recordedAt <= cutoff,
  );
  const verified = events.filter(
    (e) =>
      e.source === "COMMAND_CENTER" &&
      !!e.actorUserId &&
      (source.status !== "RESOLVED" ||
        !source.resolvedAt ||
        e.occurredAt <= source.resolvedAt),
  );
  const first = (type: string, after = start) =>
    verified
      .filter((e) => e.type === type && +e.occurredAt >= after)
      .sort(
        (a, b) => +a.occurredAt - +b.occurredAt || a.sequence - b.sequence,
      )[0];
  const ack = first("OPERATOR_ACKNOWLEDGED");
  const dispatch = ack
    ? first("OPERATOR_DISPATCHED", +ack.occurredAt)
    : undefined;
  const resolved = events.find(
    (e) =>
      e.type === "INCIDENT_RESOLVED" &&
      ["COMMAND_CENTER", "MOBILE"].includes(e.source) &&
      !!e.actorUserId &&
      record(e.payload).newStatus === "RESOLVED" &&
      source.status === "RESOLVED" &&
      source.resolvedAt?.getTime() === e.occurredAt.getTime(),
  );
  const cancelled = source.status === "CANCELLED";
  const findings: Finding[] = [];
  function timing(
    control: string,
    seconds: number | undefined,
    from: number | undefined,
    event: typeof ack,
    references: string[] = [],
  ) {
    const observed =
      event && from !== undefined ? (+event.occurredAt - from) / 1000 : null;
    const known = !!policy && seconds !== undefined && observed !== null;
    findings.push({
      control,
      status: cancelled
        ? "NOT_APPLICABLE"
        : known
          ? observed! <= seconds!
            ? "COMPLIANT"
            : "NON_COMPLIANT"
          : "INDETERMINATE",
      explanation: cancelled
        ? "Incident cancelled; response timing not assessed."
        : !policy
          ? "Applicable policy version could not be established."
          : !known
            ? "Verified milestone or prerequisite evidence is missing; no breach inferred."
            : observed! <= seconds!
              ? "Recorded milestone meets the applicable facility threshold."
              : "Verified milestone exceeds the applicable facility threshold; cause is not established.",
      thresholdSeconds: seconds ?? null,
      observedSeconds: observed,
      evidenceReferences: [
        ...references,
        ...(event ? [event.id] : []),
        ...(policy ? [policy.reference] : []),
      ],
    });
  }
  timing("ACKNOWLEDGEMENT", policy?.acknowledgementSeconds, start, ack);
  timing(
    "DISPATCH",
    policy?.dispatchSeconds,
    ack ? +ack.occurredAt : undefined,
    dispatch,
    ack ? [ack.id] : [],
  );
  timing("UNATTENDED", policy?.unattendedSeconds, start, ack);
  timing("CLOSURE", policy?.closureSeconds, start, resolved);
  const progress = dispatch
    ? verified
        .filter(
          (e) =>
            e.type === "OPERATOR_RESPONSE_PROGRESS" &&
            +e.occurredAt >= +dispatch.occurredAt,
        )
        .sort((a, b) => +a.occurredAt - +b.occurredAt)
    : [];
  const end = resolved?.occurredAt ?? cutoff;
  const points = dispatch
    ? [dispatch, ...progress.filter((e) => e.occurredAt <= end)]
    : [];
  const gaps = points.map(
    (e, i) =>
      ((points[i + 1]?.occurredAt ?? end).getTime() - +e.occurredAt) / 1000,
  );
  const maximum = gaps.length ? Math.max(...gaps) : null;
  // A gap containing no recorded update does not prove that no update occurred.
  const lateRecordedProgress = progress.some(
    (e, i) =>
      policy &&
      +e.occurredAt - +(progress[i - 1]?.occurredAt ?? dispatch!.occurredAt) >
        policy.progressSeconds * 1000,
  );
  findings.push({
    control: "RESPONSE_PROGRESS",
    status: cancelled
      ? "NOT_APPLICABLE"
      : !policy || !dispatch
        ? "INDETERMINATE"
        : lateRecordedProgress
          ? "NON_COMPLIANT"
          : maximum !== null && maximum <= policy.progressSeconds
            ? "COMPLIANT"
            : "INDETERMINATE",
    explanation:
      "Progress gaps use dispatch, recorded updates and closure/cutoff. Missing updates remain uncertain; no motive is inferred.",
    thresholdSeconds: policy?.progressSeconds ?? null,
    observedSeconds: maximum,
    evidenceReferences: [
      ...points.map((e) => e.id),
      ...(resolved ? [resolved.id] : []),
      ...(policy ? [policy.reference] : []),
    ],
  });
  findings.push({
    control: "CLOSURE_PROVENANCE",
    status: cancelled
      ? "NOT_APPLICABLE"
      : source.status !== "RESOLVED"
        ? "NOT_APPLICABLE"
        : resolved
          ? "COMPLIANT"
          : "INDETERMINATE",
    explanation: resolved
      ? "Resolution state and timestamp match the attributed authoritative lifecycle event. This does not verify the closure reason."
      : "No matching attributed lifecycle event; unsupported closure requires review, not an inferred violation.",
    evidenceReferences: resolved ? [resolved.id] : [],
    thresholdSeconds: null,
    observedSeconds: null,
  });
  return {
    policy,
    evidenceCutoff: cutoff.toISOString(),
    findings,
    complianceClaim: null,
    regulatoryMappings: [],
    uncertainty: [
      "Control findings assess recorded evidence only; institutional compliance is not certified.",
      "No explanation of delay or closure justification is inferred from elapsed time.",
    ],
  };
}
