import { beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { OperationStore } from "./canonical-operations";
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});
describe("canonical mutation integrity", () => {
  it("preserves unknown identity through authority expiry and remount", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("network"));
    const store = new OperationStore("actor", transport);
    await store.submit("invite", "facilities/example/invitations", {
      reason: "Review",
      email: "private@example.test",
    });
    const identity = store.snapshot().invite.identity;
    store.expire();
    expect(store.snapshot().invite.state).toBe("RESULT_UNKNOWN");
    const restored = new OperationStore("actor", transport);
    await restored.submit("invite", "facilities/example/invitations", {
      reason: "Review",
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(restored.snapshot().invite.identity).toBe(identity);
    expect(sessionStorage.getItem("opa-operations:actor")).not.toContain(
      "private@example.test",
    );
  });
  it("reconciles absent receipt then replays identical input with original identity", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(json({ status: "NOT_RECORDED" }))
      .mockResolvedValueOnce(json({ id: "record" }));
    const store = new OperationStore("actor", transport);
    const input = { reason: "Review" };
    await store.submit("owner", "path", input);
    const identity = store.snapshot().owner.identity;
    await store.reconcile("owner");
    await store.submit("owner", "path", input, true);
    expect(store.snapshot().owner.state).toBe("SUCCESS");
    expect(store.snapshot().owner.identity).toBe(identity);
    expect(JSON.parse(transport.mock.calls[2][1].body).correlationId).toBe(
      identity,
    );
  });
  it("rejects changed payload during uncertain replay", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValueOnce(json({ status: "NOT_RECORDED" }));
    const store = new OperationStore("actor", transport);
    await store.submit("owner", "path", { reason: "Original" });
    await store.reconcile("owner");
    await store.submit("owner", "path", { reason: "Changed" }, true);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(store.snapshot().owner.state).toBe("RESULT_UNKNOWN");
  });
  it("uses committed receipt without sending another mutation", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new Error())
      .mockResolvedValueOnce(
        json({ status: "COMMITTED", receipt: { id: "saved" } }),
      );
    const store = new OperationStore("actor", transport);
    await store.submit("owner", "path", { reason: "Review" });
    await store.reconcile("owner");
    await store.submit("owner", "path", { reason: "Review" });
    expect(store.snapshot().owner.state).toBe("SUCCESS");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("authority revision fences a late response", async () => {
    let finish!: (value: Response) => void;
    const transport = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const store = new OperationStore("actor", transport);
    const pending = store.submit("owner", "path", { reason: "Review" });
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    store.expire();
    finish(json({ id: "late" }));
    await pending;
    expect(store.snapshot().owner.state).toBe("RESULT_UNKNOWN");
    expect(store.snapshot().owner.result).toBeUndefined();
  });
  it("locks one owner while independent controls remain usable", async () => {
    let finish!: (value: Response) => void;
    const transport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(json({ id: "other" }));
    const store = new OperationStore("actor", transport);
    const pending = store.submit("one", "path", { reason: "One" });
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    await store.submit("one", "path", { reason: "One" });
    await store.submit("two", "other", { reason: "Two" });
    expect(store.snapshot().two.state).toBe("SUCCESS");
    expect(transport).toHaveBeenCalledTimes(2);
    finish(json({ id: "one" }));
    await pending;
  });
  it("server errors remain unknown rather than definite failure", async () => {
    const store = new OperationStore(
      "actor",
      vi.fn().mockResolvedValue(json({}, 503)),
    );
    await store.submit("owner", "path", { reason: "Review" });
    expect(store.snapshot().owner.state).toBe("RESULT_UNKNOWN");
  });
  it("actor namespaces do not inherit another actor operations", async () => {
    const first = new OperationStore(
      "first",
      vi.fn().mockRejectedValue(new Error()),
    );
    await first.submit("owner", "path", { reason: "Review" });
    expect(new OperationStore("second", vi.fn()).snapshot()).toEqual({});
  });
});
