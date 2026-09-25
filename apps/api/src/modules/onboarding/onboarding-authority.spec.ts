import { onboardingAuthority, platformAuthority } from "./onboarding-authority";
import { OnboardingService } from "./onboarding.service";
import {
  OnboardingController,
  OnboardingGrantsController,
} from "./onboarding.controller";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AdminGuard } from "../../shared/guards/admin.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

describe("bounded onboarding authority", () => {
  const employee = {
    id: "employee",
    role: "USER",
    isActive: true,
    accountStatus: "ACTIVE",
  };
  function client(
    actor = employee,
    grant: object[] = [{ id: "grant", approvedByUserId: "admin" }],
    active = true,
  ) {
    return {
      $queryRaw: jest.fn().mockResolvedValue(grant),
      user: { findUnique: jest.fn().mockResolvedValue(actor) },
      facility: {
        findUnique: jest.fn().mockResolvedValue({ isActive: active }),
      },
    };
  }
  it("requires both JWT authentication and unchanged AdminGuard for grant lifecycle", () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, OnboardingGrantsController),
    ).toEqual([JwtAuthGuard, AdminGuard]);
    expect(Reflect.getMetadata(GUARDS_METADATA, OnboardingController)).toEqual([
      JwtAuthGuard,
    ]);
  });
  it("keeps ADMIN a superset without a grant", async () => {
    expect(
      await onboardingAuthority(
        client({ ...employee, role: "ADMIN" }, []) as never,
        "admin",
        "facility",
      ),
    ).toMatchObject({ actorRole: "ADMIN", grantId: null });
  });
  it("preserves employee role and grant provenance", async () => {
    expect(
      await onboardingAuthority(client() as never, "employee", "facility"),
    ).toEqual({
      actorRole: "USER",
      authority: "DELEGATED_ONBOARDING",
      grantId: "grant",
      approvedByUserId: "admin",
    });
  });
  it("fails closed without a current matching database grant", async () => {
    await expect(
      onboardingAuthority(
        client(employee, []) as never,
        "employee",
        "facility",
      ),
    ).rejects.toThrow("Onboarding authority");
  });
  it.each([
    { ...employee, isActive: false },
    { ...employee, accountStatus: "PENDING_ACTIVATION" },
  ])("denies inactive actor %p", async (actor) => {
    await expect(
      onboardingAuthority(client(actor) as never, "employee", "facility"),
    ).rejects.toThrow("Onboarding authority");
  });
  it("denies inactive facilities even for ADMIN", async () => {
    await expect(
      onboardingAuthority(
        client({ ...employee, role: "ADMIN" }, [], false) as never,
        "admin",
        "facility",
      ),
    ).rejects.toThrow("Onboarding authority");
  });
  it("requires ADMIN for grant management", async () => {
    await expect(
      platformAuthority(client() as never, "employee"),
    ).rejects.toThrow("Platform authority");
  });
  it("denies resident invitation before enrollment", () => {
    const enrollment = { request: jest.fn() };
    const service = new OnboardingService(
      {} as never,
      enrollment as never,
      {} as never,
    );
    expect(() =>
      service.invite("employee", {} as never, "key", "USER" as never),
    ).toThrow("Staff onboarding only");
    expect(enrollment.request).not.toHaveBeenCalled();
  });
});
