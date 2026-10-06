import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  institutionalTokens: vi.fn(),
  clearInstitutionalSession: vi.fn(),
  setInstitutionalSession: vi.fn(),
  clearOperatorSession: vi.fn(),
  upstream: vi.fn(),
  setOperatorSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("./institutional-session", () => ({
  institutionalTokens: mocks.institutionalTokens,
  clearInstitutionalSession: mocks.clearInstitutionalSession,
  setInstitutionalSession: mocks.setInstitutionalSession,
}));

vi.mock("./super-admin-api", () => ({
  AdminFailure: class AdminFailure extends Error {
    constructor(public status: number) {
      super("request failed");
    }
  },
  upstream: mocks.upstream,
}));

vi.mock("./operator-session", () => ({
  setOperatorSession: mocks.setOperatorSession,
  clearOperatorSession: mocks.clearOperatorSession,
}));

import { operatorHandoff } from "./operator-handoff";

describe("operator institutional session handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.institutionalTokens.mockResolvedValue({
      accessToken: "institutional-access",
      refreshToken: "institutional-refresh",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("establishes operator presentation session for current FACILITY_OPERATOR authority", async () => {
    mocks.upstream.mockResolvedValue({
      actor: {
        id: "barry",
        role: "FACILITY_OPERATOR",
      },
      facilities: [
        {
          id: "facility-1",
          name: "IKEJA FACE1",
        },
      ],
    });

    await expect(operatorHandoff()).resolves.toEqual({
      ok: true,
      facilityId: "facility-1",
    });

    expect(mocks.upstream).toHaveBeenCalledWith(
      "/institutional/context",
      "institutional-access",
    );

    expect(mocks.setOperatorSession).toHaveBeenCalledWith({
      accessToken: "institutional-access",
      refreshToken: "institutional-refresh",
    });
  });

  it.each([
    ["FACILITY_ADMIN", "kane"],
    ["TECHNICAL_SUPPORT", "erick"],
    ["ADMIN", "admin"],
  ])("denies %s without creating an operator session", async (role, id) => {
    mocks.upstream.mockResolvedValue({
      actor: { id, role },
      facilities: [{ id: "facility-1", name: "IKEJA FACE1" }],
    });

    await expect(operatorHandoff()).rejects.toMatchObject({
      status: 403,
    });

    expect(mocks.setOperatorSession).not.toHaveBeenCalled();
  });

  it("denies a missing institutional session", async () => {
    mocks.institutionalTokens.mockResolvedValue({});

    await expect(operatorHandoff()).rejects.toMatchObject({
      status: 401,
    });

    expect(mocks.upstream).not.toHaveBeenCalled();
    expect(mocks.setOperatorSession).not.toHaveBeenCalled();
  });

  it("denies operator handoff when current authority has no facility", async () => {
    mocks.upstream.mockResolvedValue({
      actor: {
        id: "barry",
        role: "FACILITY_OPERATOR",
      },
      facilities: [],
    });

    await expect(operatorHandoff()).rejects.toMatchObject({
      status: 403,
    });

    expect(mocks.setOperatorSession).not.toHaveBeenCalled();
  });

  it("does not create operator session when current authority revalidation fails", async () => {
    const { AdminFailure } = await import("./super-admin-api");

    mocks.upstream.mockRejectedValue(new AdminFailure(403));

    await expect(operatorHandoff()).rejects.toMatchObject({
      status: 403,
    });

    expect(mocks.setOperatorSession).not.toHaveBeenCalled();
  });

  it("preserves upstream outage semantics and creates no operator session", async () => {
    const { AdminFailure } = await import("./super-admin-api");

    mocks.upstream.mockRejectedValue(new AdminFailure(503));

    await expect(operatorHandoff()).rejects.toMatchObject({
      status: 503,
    });

    expect(mocks.setOperatorSession).not.toHaveBeenCalled();
  });
});
