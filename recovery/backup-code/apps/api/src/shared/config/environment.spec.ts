import { initializeEnvironment } from "./environment";
import { PrismaClient } from "@prisma/client";
jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("@prisma/client", () => ({ PrismaClient: jest.fn() }));
describe("startup preflight ordering", () => {
  const original = process.env;
  beforeEach(() => {
    process.env = {};
    jest.clearAllMocks();
  });
  afterEach(() => {
    process.env = original;
  });
  it("missing environment fails before any database client construction", async () => {
    await expect(initializeEnvironment()).rejects.toThrow("preflight");
    expect(PrismaClient).not.toHaveBeenCalled();
  });
  it("untrusted hosted configuration fails before connecting", async () => {
    process.env.OPA_ENVIRONMENT = "staging";
    process.env.NODE_ENV = "production";
    await expect(initializeEnvironment()).rejects.toThrow("preflight");
    expect(PrismaClient).not.toHaveBeenCalled();
  });
});
