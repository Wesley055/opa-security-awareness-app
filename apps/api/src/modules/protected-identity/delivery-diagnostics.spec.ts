import { ProtectedIdentityService } from "./protected-identity.service";
import { ProtectedSnapshotsService } from "./protected-snapshots.service";
import { deliveryDiagnostic } from "../notifications/delivery-diagnostics";
const ref = "00000000-0000-4000-8000-000000000001";
describe("protected delivery safe failure stages", () => {
  const env = {...process.env};
  afterEach(() => { process.env = {...env}; });
  function fixture() {
    const tx = { identityAccessGrant: {findFirst: jest.fn().mockResolvedValue({id: "grant"})}, protectedIdentifier: {findFirst: jest.fn().mockResolvedValue({ id: "snapshot", kind: "NOTIFICATION_SNAPSHOT", formatVersion: 1, normalizationVersion: 1 })}, identityResolutionAudit: {create: jest.fn().mockResolvedValue({})} };
    const db = {$transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))};
    const crypto = {open: jest.fn().mockResolvedValue("private plaintext")};
    const service = new ProtectedIdentityService(db as never, crypto as never);
    const resolve = () => service.resolve("actor", "tenant", "snapshot", "DELIVERY", ref);
    return {tx, db, crypto, resolve};
  }
  it.each(["authorization", "crypto", "audit", "commit", "snapshot"])("retains a safe code for %s, never releases plaintext on failure", async step => {
    const f=fixture(); const secret=new Error("sensitive db parameter and credential");
    if(step==="authorization") f.tx.identityAccessGrant.findFirst.mockResolvedValue(null);
    if(step==="crypto") f.crypto.open.mockRejectedValue(secret);
    if(step==="audit") f.tx.identityResolutionAudit.create.mockRejectedValue(secret);
    if(step==="snapshot") f.tx.protectedIdentifier.findFirst.mockResolvedValue(null);
    if(step==="commit") f.db.$transaction.mockImplementation(async fn => {await fn(f.tx);throw secret;});
    const expected: Record<string,string>={authorization:"DELIVERY_AUTHORIZATION_DENIED",crypto:"CRYPTO_DECRYPTION_FAILED",audit:"AUDIT_PERSISTENCE_FAILED",commit:"AUDIT_PERSISTENCE_FAILED",snapshot:"SNAPSHOT_RESOLUTION_FAILED"};
    await expect(f.resolve()).rejects.toThrow();
    const error=await f.resolve().catch(e=>e);
    expect(deliveryDiagnostic(error,"SNAPSHOT_RESOLUTION_FAILED")).toBe(expected[step]);
    expect(JSON.stringify(error)).not.toMatch(/sensitive|credential|private plaintext/);
  });
  it("marks missing actor without resolving or decrypting", async () => {
    delete process.env.PII_DELIVERY_ACTORS_JSON; delete process.env.PII_DELIVERY_ACTOR_USER_ID;
    const identities={resolve:jest.fn()};
    const db={incidentNotification:{findFirst:jest.fn().mockResolvedValue({incident:{userId:"subject"}})},protectedIdentifier:{findFirst:jest.fn().mockResolvedValue({tenantId:"tenant"})}};
    const service=new ProtectedSnapshotsService(db as never,identities as never);
    const error=await service.notificationPayload("snapshot",ref).catch(e=>e);
    expect(deliveryDiagnostic(error,"SNAPSHOT_RESOLUTION_FAILED")).toBe("DELIVERY_ACTOR_UNAVAILABLE");
    expect(identities.resolve).not.toHaveBeenCalled();
  });
  it("marks malformed protected payload after audited resolution", async () => {
    process.env.PII_DELIVERY_ACTOR_USER_ID=ref;delete process.env.PII_DELIVERY_ACTORS_JSON;
    const identities={resolve:jest.fn().mockResolvedValue(JSON.stringify({version:1,payload:{bad:true}}))};
    const db={incidentNotification:{findFirst:jest.fn().mockResolvedValue({incident:{userId:"subject"}})},protectedIdentifier:{findFirst:jest.fn().mockResolvedValue({tenantId:"tenant"})}};
    const error=await new ProtectedSnapshotsService(db as never,identities as never).notificationPayload("snapshot",ref).catch(e=>e);
    expect(deliveryDiagnostic(error,"SNAPSHOT_RESOLUTION_FAILED")).toBe("PAYLOAD_VALIDATION_FAILED");
  });
});
