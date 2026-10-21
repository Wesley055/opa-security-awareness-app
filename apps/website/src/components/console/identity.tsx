export function roleLabel(role: string) {
  return (
    (
      {
        ADMIN: "Platform Administrator",
        TECHNICAL_SUPPORT: "Technical Support",
        FACILITY_ADMIN: "Facility Administrator",
        FACILITY_OPERATOR: "Facility Operator",
        USER: "Resident",
      } as Record<string, string>
    )[role] ?? "Authenticated account"
  );
}
export function ConsoleIdentity({
  name,
  role,
  scope,
}: {
  name?: string;
  role: string;
  scope?: string;
}) {
  return (
    <div
      aria-label="Current authenticated identity"
      className="console-identity"
    >
      <p className="font-display text-ink">
        {name?.trim() || "Authenticated account"}
      </p>
      <p className="text-sm text-muted">{roleLabel(role)}</p>
      {scope && (
        <p className="text-sm text-muted" aria-label="Current scope">
          {scope}
        </p>
      )}
    </div>
  );
}

export function ConsoleStatus({ value }: { value: string }) {
  const tone = ["SUSPENDED", "REVOKED", "FAILED", "ENDED"].includes(value)
    ? "var(--color-emergency)"
    : ["COMMISSIONING", "PENDING_ACTIVATION", "PENDING", "UNKNOWN"].includes(
          value,
        )
      ? "#ffb300"
      : ["LIVE", "ACTIVE", "OPERATIONAL", "OPEN", "DELIVERED"].includes(value)
        ? "var(--color-protection)"
        : "var(--color-muted)";
  return (
    <span
      className="font-mono text-xs"
      style={{
        color: tone,
        border: "1px solid currentColor",
        borderRadius: ".375rem",
        padding: ".2rem .45rem",
        display: "inline-block",
      }}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
