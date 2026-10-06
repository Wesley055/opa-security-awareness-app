import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { prismaTest as db } from "./prisma-test-client";
import { CanonicalOrganizationService } from "../../src/modules/onboarding/canonical-organization.service";
import { AdminProvisioningService } from "../../src/modules/admin-provisioning/admin-provisioning.service";
const service = new CanonicalOrganizationService(db as never),
  provisioning = new AdminProvisioningService(db as never);
const context = () => ({
  reason: "Synthetic reviewed association",
  caseReference: randomUUID(),
  correlationId: randomUUID(),
});
let admin: string, a: string, b: string, f: string;
const person = async (role: UserRole) =>
  (
    await db.user.create({
      data: {
        role,
        email: randomUUID() + "@example.test",
        phoneNumber: randomUUID(),
        firstName: "Synthetic",
        lastName: "Test",
      },
    })
  ).id;
beforeEach(async () => {
  admin = await person("ADMIN");
  a = (
    await service.createOrganization(
      admin,
      "Synthetic organization A",
      context(),
    )
  ).id;
  b = (
    await service.createOrganization(
      admin,
      "Synthetic organization B",
      context(),
    )
  ).id;
  f = (
    await provisioning.createFacility(
      { name: "Synthetic facility", type: "OTHER" },
      admin,
    )
  ).id;
});
it("persists selected OTHER and nullable association, then returns both sides of the explicit hierarchy", async () => {
  expect(
    (await service.overview(admin)).facilities.find((x) => x.id === f),
  ).toMatchObject({ type: "OTHER", organizationId: null, organization: null });
  await service.associate(admin, f, a, context());
  const row = await db.facility.findUniqueOrThrow({ where: { id: f } });
  expect(row).toMatchObject({ type: "OTHER", organizationId: a });
  const view = await service.overview(admin);
  expect(view.organizations.find((x) => x.id === a)?.name).toBe(
    "Synthetic organization A",
  );
  expect(view.facilities.find((x) => x.id === f)).toMatchObject({
    organizationId: a,
    organization: { id: a, name: "Synthetic organization A" },
    type: "OTHER",
  });
  expect(
    (
      await db.organization.findUniqueOrThrow({
        where: { id: a },
        include: { facilities: true },
      })
    ).facilities.map((x) => x.id),
  ).toEqual([f]);
});
it.each([
  "FACILITY_ADMIN",
  "FACILITY_OPERATOR",
  "TECHNICAL_SUPPORT",
  "USER",
  "RESPONDER",
] as UserRole[])(
  "denies association and governance discovery for %s",
  async (role) => {
    const actor = await person(role);
    await expect(
      service.associate(actor, f, a, context()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service.overview(actor)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      (await db.facility.findUniqueOrThrow({ where: { id: f } }))
        .organizationId,
    ).toBeNull();
  },
);
it("audits actual ADMIN and before/after association; replay produces one receipt", async () => {
  const ctx = context();
  await Promise.all([
    service.associate(admin, f, a, ctx),
    service.associate(admin, f, a, ctx),
  ]);
  const events = await db.administrativeAuditEvent.findMany({
    where: { action: "FACILITY_ORGANIZATION_CHANGED", resourceId: f },
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    actorUserId: admin,
    actorRole: "ADMIN",
    authorityKind: "PLATFORM_ADMIN",
    reason: ctx.reason,
    correlationId: ctx.correlationId,
    beforeState: { organizationId: null },
    afterState: { result: { organizationId: a } },
  });
});
it("rejects moving an already associated facility and leaves history intact", async () => {
  await service.associate(admin, f, a, context());
  await expect(service.associate(admin, f, b, context())).rejects.toMatchObject(
    { status: 409 },
  );
  expect(
    (await db.facility.findUniqueOrThrow({ where: { id: f } })).organizationId,
  ).toBe(a);
});
it("serializes competing initial associations; exactly one organization wins", async () => {
  const results = await Promise.allSettled([
    service.associate(admin, f, a, context()),
    service.associate(admin, f, b, context()),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
  expect(
    await db.administrativeAuditEvent.count({
      where: { action: "FACILITY_ORGANIZATION_CHANGED", resourceId: f },
    }),
  ).toBe(1);
});
it("allows same-parent retries with a new reviewed request without moving tenant records", async () => {
  await service.associate(admin, f, a, context());
  await service.associate(admin, f, a, context());
  expect(
    (await db.facility.findUniqueOrThrow({ where: { id: f } })).organizationId,
  ).toBe(a);
  expect(await db.facility.count()).toBe(1);
});
it.each(["inactive", "role"] as const)(
  "denies stale %s platform authority, including replay",
  async (kind) => {
    const ctx = context();
    await service.associate(admin, f, a, ctx);
    await db.user.update({
      where: { id: admin },
      data: kind === "inactive" ? { isActive: false } : { role: "USER" },
    });
    await expect(service.associate(admin, f, a, ctx)).rejects.toMatchObject({
      status: 403,
    });
  },
);
it("rejects nonexistent organization and missing reason without association", async () => {
  await expect(
    service.associate(admin, f, randomUUID(), context()),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.associate(admin, f, a, { ...context(), reason: " " }),
  ).rejects.toMatchObject({ status: 400 });
  expect(
    (await db.facility.findUniqueOrThrow({ where: { id: f } })).organizationId,
  ).toBeNull();
});
