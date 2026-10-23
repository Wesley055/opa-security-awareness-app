import { AuthService } from "./auth.service";
import * as bcrypt from "bcrypt";
jest.mock("bcrypt", () => ({
  hash: jest.fn(async () => "dummy-hash"),
  compare: jest.fn(async () => false),
}));
describe("login equivalent credential work", () => {
  it.each([
    null,
    { isActive: true, accountStatus: "ACTIVE", passwordHash: "real-hash" },
    { isActive: false, accountStatus: "ACTIVE", passwordHash: "real-hash" },
    { isActive: true, accountStatus: "PENDING_ACTIVATION", passwordHash: null },
  ])("performs one bcrypt comparison before refusing %p", async (user) => {
    jest.clearAllMocks();
    const service = new AuthService(
      { findByEmail: jest.fn(async () => user) } as never,
      {} as never,
      { getOrThrow: () => 12 } as never,
    );
    await expect(
      service.login({
        email: "test@example.test",
        password: "incorrect-password",
      }),
    ).rejects.toThrow("Invalid credentials.");
    expect(bcrypt.hash).toHaveBeenCalledWith(expect.any(String), 12);
    expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    expect(bcrypt.compare).toHaveBeenCalledWith(
      "incorrect-password",
      user?.passwordHash ?? "dummy-hash",
    );
  });
});
