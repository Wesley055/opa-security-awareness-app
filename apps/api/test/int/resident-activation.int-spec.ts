import { randomBytes, randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { prismaTest as db } from "./prisma-test-client";
import { AdminProvisioningService } from "../../src/modules/admin-provisioning/admin-provisioning.service";
import { InvitationDeliveryWorker } from "../../src/modules/admin-provisioning/invitation-delivery.worker";
import { ActivationService } from "../../src/modules/auth/activation.service";
import { hashActivationCredential } from "../../src/shared/security/activation-code";
const provisioning = new AdminProvisioningService(db as never);
const password = () => randomBytes(24).toString("base64url");
let facility: string, actor: string, resident: string, code: string, correlationId: string;
const tokens = { issueTokens: jest.fn(async (user: unknown) => ({ user })) };
const activation = new ActivationService(
  db as never,
  new ConfigService({ BCRYPT_ROUNDS: 4 }),
  tokens as never,
);
beforeEach(async () => {
  tokens.issueTokens.mockClear();
  facility = (
    await db.facility.create({
      data: {
        name: "Synthetic resident activation",
        type: "OTHER",
        isActive: true,
      },
    })
  ).id;
  actor = (
    await db.user.create({
      data: {
        email: randomUUID() + "@example.test",
        phoneNumber:
          "+23480" +
          String(
            BigInt("0x" + randomBytes(5).toString("hex")) % 100000000n,
          ).padStart(8, "0"),
        firstName: "Synthetic",
        lastName: "Administrator",
        role: "FACILITY_ADMIN",
        facilityId: facility,
        isActive: true,
        accountStatus: "ACTIVE",
      },
    })
  ).id;
  correlationId = randomUUID();
  const result = await provisioning.createResidentInvite(actor, {
    firstName: "Synthetic",
    lastName: "Resident",
    email: randomUUID() + "@example.test",
    phoneNumber:
      "+23480" +
      String(
        BigInt("0x" + randomBytes(5).toString("hex")) % 100000000n,
      ).padStart(8, "0"),
    facilityId: facility,
  }, { reason: "Synthetic legacy invitation audit", correlationId });
  resident = result.user.id;
  const send = jest.fn(async (message: { message: string }) => {
    code = message.message
      .match(/Your code: ([0-9A-Z]{4})-([0-9A-Z]{4})/)!
      .slice(1)
      .join("");
    return {
      success: true,
      provider: "AFRICASTALKING",
      messageId: randomUUID(),
    };
  });
  await new InvitationDeliveryWorker(
    db as never,
    { send } as never,
    { send: jest.fn() } as never,
    new ConfigService(),
    {} as never,
  ).tick();
  expect(send).toHaveBeenCalledTimes(1);
  expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
});
afterAll(() => db.$disconnect());
it("uses only the invited facility, hashes the worker code, activates once and retains provenance", async () => {
  const before = await db.user.findUniqueOrThrow({ where: { id: resident } });
  expect(before.activationTokenHash).toBe(hashActivationCredential(code));
  expect(before.activationExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
    23 * 60 * 60 * 1000,
  );
  expect(
    JSON.stringify(
      await db.accountInvitationDelivery.findMany({
        where: { userId: resident },
      }),
    ),
  ).not.toContain(code);
  await activation.activate({
    token: code.slice(0, 4) + "-" + code.slice(4).toLowerCase(),
    password: password(),
  });
  expect(await db.user.findUnique({ where: { id: resident } })).toMatchObject({
    accountStatus: "ACTIVE",
    facilityId: facility,
    activationTokenHash: null,
  });
  await expect(
    activation.activate({ token: code, password: password() }),
  ).rejects.toThrow();
  expect(
    await db.administrativeAuditEvent.findFirst({
      where: { resourceId: resident, action: "RESIDENT_INVITATION_QUEUED" },
    }),
  ).toMatchObject({
    actorUserId: actor,
    actorRole: "FACILITY_ADMIN",
    facilityId: facility,
    reason: "Synthetic legacy invitation audit",
    correlationId,
  });
  expect(
    await db.administrativeAuditEvent.count({
      where: { resourceId: resident, action: "RESIDENT_ACTIVATED" },
    }),
  ).toBe(1);
});
it.each(["SUSPENDED", "DECOMMISSIONED"] as const)(
  "denies facility state %s",
  async (state) => {
    await db.facility.update({
      where: { id: facility },
      data: { operationalState: state },
    });
    await expect(
      activation.activate({ token: code, password: password() }),
    ).rejects.toThrow();
    expect(tokens.issueTokens).not.toHaveBeenCalled();
  },
);
it.each(["SUSPENDED", "REVOKED"] as const)(
  "denies membership state %s",
  async (state) => {
    await db.user.update({
      where: { id: resident },
      data: { membershipState: state },
    });
    await expect(
      activation.activate({ token: code, password: password() }),
    ).rejects.toThrow();
  },
);
it("denies expired code", async () => {
  await db.user.update({
    where: { id: resident },
    data: { activationExpiresAt: new Date(0) },
  });
  await expect(
    activation.activate({ token: code, password: password() }),
  ).rejects.toThrow();
});
it("denies cancelled invitation", async () => {
  await db.accountInvitationDelivery.updateMany({
    where: { userId: resident },
    data: { status: "CANCELLED" },
  });
  await expect(
    activation.activate({ token: code, password: password() }),
  ).rejects.toThrow();
});
it("denies a code after cross-facility reassignment", async () => {
  const other = await db.facility.create({
    data: { name: "Synthetic other", type: "OTHER" },
  });
  await db.user.update({
    where: { id: resident },
    data: { facilityId: other.id },
  });
  await expect(
    activation.activate({ token: code, password: password() }),
  ).rejects.toThrow();
});
it("denies a foreign-facility inviter", async () => {
  const other = await db.facility.create({
    data: { name: "Synthetic foreign", type: "OTHER" },
  });
  await expect(
    provisioning.createResidentInvite(actor, {
      firstName: "Synthetic",
      lastName: "Denied",
      email: randomUUID() + "@example.test",
      phoneNumber: "+2348000000000",
      facilityId: other.id,
    }),
  ).rejects.toThrow();
});

it("replays a legacy invitation operation without another account, delivery or audit", async () => {
  const dto = { firstName: "Synthetic", lastName: "Replay", email: randomUUID()+"@example.test", phoneNumber: "+23480"+String(BigInt("0x"+randomBytes(5).toString("hex"))%100000000n).padStart(8,"0"), facilityId: facility };
  const key = randomUUID();
  const [first, second] = await Promise.all([provisioning.createResidentInvite(actor,dto,undefined,key),provisioning.createResidentInvite(actor,dto,undefined,key)]);
  expect(second.user.id).toBe(first.user.id);
  expect(second.delivery.id).toBe(first.delivery.id);
  expect(await db.accountInvitationDelivery.count({where:{userId:first.user.id}})).toBe(1);
  expect(await db.administrativeAuditEvent.count({where:{resourceId:first.user.id,action:"RESIDENT_INVITATION_QUEUED"}})).toBe(1);
  await expect(provisioning.createResidentInvite(actor,{...dto,lastName:"Changed"},undefined,key)).rejects.toThrow("different input");
});
