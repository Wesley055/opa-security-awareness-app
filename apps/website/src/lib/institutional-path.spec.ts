import { describe, it, expect } from "vitest";
import {
  institutionalPath,
  institutionalProjection,
} from "./institutional-path";
const id = "11111111-1111-4111-8111-111111111111";
describe("institutional bridge boundaries", () => {
  it("allows only exact methods and paths", () => {
    expect(institutionalPath("facilities/" + id + "/members", "GET")).toBe(
      "/institutional/facilities/" + id + "/members",
    );
    for (const p of [
      "../admin/facilities",
      "https://example.test",
      "facilities/" + id + "/delete",
      "incidents/" + id + "/cancel",
      "protected-identities/" + id + "/resolve",
    ])
      expect(institutionalPath(p, "POST")).toBeNull();
    expect(institutionalPath("facilities", "DELETE")).toBeNull();
    expect(institutionalPath("admin/accounts/" + id + "/recover", "POST")).toBe(
      "/admin/support/accounts/" + id + "/recover",
    );
    expect(
      institutionalPath("admin/accounts/" + id + "/recover", "GET"),
    ).toBeNull();
  });
  it("allows read-only invitation eligibility and retains only safe directory fields", () => {
    expect(institutionalPath("facilities/" + id + "/invitation-roles", "GET")).toBe("/institutional/facilities/" + id + "/invitation-roles");
    expect(institutionalPath("facilities/" + id + "/invitation-roles", "POST")).toBeNull();
    expect(institutionalProjection({ displayIdentity: "K••• · Account ABC", email: "private@example.test", firstName: "Private", roles: ["USER"], explanation: "Current authority" })).toEqual({ displayIdentity: "K••• · Account ABC", roles: ["USER"], explanation: "Current authority" });
  });
  it("removes secrets and protected identity recursively", () => {
    expect(
      institutionalProjection({
        actor: { id, role: "TECHNICAL_SUPPORT", email: "private@example.test" },
        password: "removed",
        identityCiphertext: "removed",
        facilities: [{ id, name: "A", phoneNumber: "removed" }],
      }),
    ).toEqual({
      actor: { id, role: "TECHNICAL_SUPPORT" },
      facilities: [{ id, name: "A" }],
    });
  });
});
