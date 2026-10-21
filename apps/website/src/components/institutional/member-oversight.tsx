type Row = Record<string, unknown>;
const human = (value: unknown) =>
  String(value ?? "Unknown")
    .toLowerCase()
    .replaceAll("_", " ");
export function MemberOversight({
  members,
  oversight,
}: {
  members: Row[];
  oversight: Row | undefined;
}) {
  const incidents = Array.isArray(oversight?.incidents)
    ? (oversight.incidents as Row[])
    : [];
  return (
    <section>
      <h3>Operator operational oversight</h3>
      <p>
        Current membership and recorded activity on open incidents. This is not
        live presence or a finding about personnel motive.
      </p>
      {!oversight && (
        <p>
          Operational records are unavailable under current scope or
          permissions. Refresh facility context to retry.
        </p>
      )}
      {oversight?.policyState !== "CONFIGURED" && (
        <p>
          Response policy is not confirmed; overdue milestones cannot be
          assessed.
        </p>
      )}
      {members
        .filter((m) => m.role === "FACILITY_OPERATOR")
        .map((member) => {
          const events = incidents
            .flatMap((incident) =>
              (Array.isArray(incident.events) ? (incident.events as Row[]) : [])
                .filter((e) => e.actorUserId === member.id)
                .map((e): Row => ({ ...e, incidentId: incident.id })),
            )
            .sort((a, b) =>
              String(b.occurredAt).localeCompare(String(a.occurredAt)),
            );
          return (
            <article className="ic-card" key={String(member.id)}>
              <h4>{String(member.displayIdentity ?? "Protected operator")}</h4>
              <p>
                Operator · Membership: {human(member.membershipState)} ·
                Account: {human(member.accountStatus)} ·{" "}
                {member.isActive ? "Enabled" : "Suspended"}
              </p>
              <p>
                {events.length
                  ? "Recent recorded activity (up to five events):"
                  : "No Operator activity recorded on the returned open incidents. This does not establish inactivity."}
              </p>
              <ul>
                {events.slice(0, 5).map((e) => (
                  <li key={String(e.id)}>
                    {human(e.type)} · {String(e.occurredAt)}
                    <details>
                      <summary>Details / audit</summary>Event: {String(e.id)};
                      Incident: {String(e.incidentId)}; Actor:{" "}
                      {String(member.id)}
                    </details>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      <h4>Open-incident exceptions</h4>
      <p>
        Exceptions belong to incidents; they are not automatically attributed to
        an Operator.
      </p>
      {incidents.map((incident, index) => (
        <article key={String(incident.id)}>
          <h5>
            Incident opened {String(incident.createdAt)} · Record {index + 1}
          </h5>
          <p>
            {Array.isArray(incident.currentExceptions) &&
            incident.currentExceptions.length
              ? incident.currentExceptions.map(human).join("; ")
              : oversight?.policyState === "CONFIGURED"
                ? "No current overdue milestone recorded."
                : "Exception assessment unavailable."}
          </p>
          <details>
            <summary>Details / provenance</summary>
            <pre>{JSON.stringify(incident, null, 2)}</pre>
          </details>
        </article>
      ))}
      <p>
        Results cover the current bounded facility roster and up to 100 open
        incidents; use Details for record provenance.
      </p>
    </section>
  );
}
