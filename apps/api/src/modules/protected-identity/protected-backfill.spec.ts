import { runProtectedBackfillBatch } from "./protected-backfill";
const item = {
  sourceId: "00000000-0000-4000-8000-000000000001",
  kind: "INVITATION_SNAPSHOT" as const,
  expectedUpdatedAt: new Date(0),
};
describe("bounded protected backfill orchestration", () => {
  it("checkpoints safe failures and preserves later progress and verification counts", async () => {
    const backfill = jest
      .fn()
      .mockRejectedValueOnce(new Error("secret recipient"))
      .mockResolvedValueOnce({ status: "PROTECTED" })
      .mockResolvedValueOnce({ status: "ALREADY_PROTECTED" });
    const record = jest.fn().mockResolvedValue(undefined);
    expect(
      await runProtectedBackfillBatch(
        { backfill },
        "actor",
        "tenant",
        [item, item, item],
        { record },
        true,
      ),
    ).toEqual({
      attempted: 3,
      ready: 0,
      protected: 1,
      verifiedExisting: 1,
      failed: 1,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("secret recipient");
  });
  it("stops when the durable checkpoint fails and allows idempotent replay", async () => {
    const backfill = jest.fn().mockResolvedValue({ status: "PROTECTED" });
    await expect(
      runProtectedBackfillBatch(
        { backfill },
        "actor",
        "tenant",
        [item, item],
        { record: jest.fn().mockRejectedValue(new Error("storage secret")) },
        true,
      ),
    ).rejects.toThrow("checkpoint unavailable");
    expect(backfill).toHaveBeenCalledTimes(1);
    backfill.mockResolvedValue({ status: "ALREADY_PROTECTED" });
    expect(
      (
        await runProtectedBackfillBatch(
          { backfill },
          "actor",
          "tenant",
          [item],
          { record: async () => undefined },
          true,
        )
      ).verifiedExisting,
    ).toBe(1);
  });
  it("defaults to dry-run and rejects oversized batches before writes", async () => {
    const backfill = jest.fn().mockResolvedValue({ status: "READY" });
    await runProtectedBackfillBatch({ backfill }, "actor", "tenant", [item], {
      record: async () => undefined,
    });
    expect(backfill).toHaveBeenCalledWith(
      "actor",
      "tenant",
      item.kind,
      item.sourceId,
      item.expectedUpdatedAt,
      false,
    );
    backfill.mockClear();
    await expect(
      runProtectedBackfillBatch(
        { backfill },
        "actor",
        "tenant",
        Array.from({ length: 101 }, () => item),
        { record: async () => undefined },
      ),
    ).rejects.toThrow("100");
    expect(backfill).not.toHaveBeenCalled();
  });
});
