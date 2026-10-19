import { ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { NotificationService } from "./notification.service";

const p = {} as never;
const row = (id: string) => ({
  id,
  incidentId: "11111111-1111-4111-8111-111111111111",
  contactId: null,
  contactName: "Ada",
  contactType: "FAMILY",
  recipient: "+2348000000000",
  channel: "SMS" as const,
  status: "QUEUED" as const,
  attemptCount: 0,
  payload: { version: 1 },
});

describe("SOS is never blocked by contact-alert protection", () => {
  it("records a FAILED alert with no plaintext and still creates the rows", async () => {
    const snapshots = {
      notificationData: jest
        .fn()
        .mockRejectedValueOnce(new ServiceUnavailableException("Protected snapshot unavailable."))
        .mockImplementationOnce(async (_tx: unknown, v: object) => ({ ...v, recipient: "[protected]" })),
    };
    const service = new NotificationService(p, p, p, p, p, p, snapshots as never, p);
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    await service.queueMany({ incidentNotification: { createMany } } as never, { data: [row("a"), row("b")] } as never);
    const data = createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      id: "a",
      status: "FAILED",
      recipient: "[protected]",
      contactName: "[protected]",
      protectedSnapshotId: null,
      lastError: "PROTECTED_DELIVERY_UNAVAILABLE",
    });
    expect(data[0].payload).toBe(Prisma.DbNull);
    expect(JSON.stringify(data[0])).not.toContain("+2348000000000");
    expect(data[1]).toMatchObject({ id: "b", recipient: "[protected]" });
  });
});
