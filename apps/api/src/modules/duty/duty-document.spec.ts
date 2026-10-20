import { buildDocument, documentDigest } from "./duty-document";

const from = new Date("2026-10-20T06:00:00Z"), to = new Date("2026-10-20T18:00:00Z");
const inc = (id: string, createdAt: string, status = "OPEN", resolvedAt: string | null = null) => ({ id, trigger: "SOS_BUTTON", status, createdAt: new Date(createdAt), resolvedAt: resolvedAt ? new Date(resolvedAt) : null });

describe("duty report document", () => {
  it("puts each incident in exactly one bucket, never twice", () => {
    const a = inc("aaaaaaaa-0000-0000-0000-000000000001", "2026-10-20T07:00:00Z");
    const d = buildDocument({ facilityType: "ESTATE", from, to, incidents: [a, a, inc("bbbbbbbb-0000-0000-0000-000000000002", "2026-10-19T22:00:00Z")], acknowledgements: [], sections: [] });
    expect(d.totals).toMatchObject({ raised: 1, carriedOver: 1 });
    expect([...d.incidents.raised, ...d.incidents.carriedOver].map((i) => i.id)).toHaveLength(2);
    expect(d.membersLabel).toBe("residents");
  });

  it("marks acknowledged only with a real acknowledgement inside the incident's life", () => {
    const a = inc("aaaaaaaa-0000-0000-0000-000000000001", "2026-10-20T07:00:00Z", "RESOLVED", "2026-10-20T08:00:00Z");
    const b = inc("bbbbbbbb-0000-0000-0000-000000000002", "2026-10-20T09:00:00Z");
    const c = inc("cccccccc-0000-0000-0000-000000000003", "2026-10-20T10:00:00Z");
    const d = buildDocument({
      facilityType: "BANK", from, to, incidents: [a, b, c], sections: [],
      acknowledgements: [
        { incidentId: a.id, occurredAt: new Date("2026-10-20T07:05:00Z") },
        { incidentId: b.id, occurredAt: new Date("2026-10-20T19:00:00Z") }, // after the cutoff: not counted
      ],
    });
    const byId = Object.fromEntries(d.incidents.raised.map((r) => [r.id, r]));
    expect(byId[a.id]!.acknowledged).toBe(true);
    expect(byId[b.id]!.acknowledged).toBe(false);
    expect(byId[c.id]!.acknowledged).toBe(false);
    expect(d.totals).toMatchObject({ acknowledged: 1, notAcknowledgedOrUnknown: 2, stillOpenAtCutoff: 2 });
    expect(d.membersLabel).toBe("customers and staff");
  });

  it("has a stable digest independent of key order", () => {
    const base = { facilityType: "OTHER" as const, from, to, incidents: [], acknowledgements: [], sections: [] };
    expect(documentDigest(buildDocument(base))).toMatch(/^[0-9a-f]{64}$/);
    expect(documentDigest(buildDocument(base))).toBe(documentDigest(buildDocument(base)));
    expect(buildDocument(base).membersLabel).toBe("members");
  });
});
