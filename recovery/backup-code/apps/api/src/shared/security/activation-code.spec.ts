import {
  ACTIVATION_CODE_ALPHABET,
  ACTIVATION_CODE_LENGTH,
  generateActivationCode,
  normalizeActivationCredential,
} from "./activation-code";

describe("activation-code", () => {
  it("generates an eight-character Crockford Base32 code", () => {
    for (let i = 0; i < 100; i += 1) {
      const code = generateActivationCode();

      expect(code).toHaveLength(ACTIVATION_CODE_LENGTH);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);

      for (const character of code) {
        expect(ACTIVATION_CODE_ALPHABET).toContain(character);
      }
    }
  });

  it("normalises human-entered Crockford equivalents", () => {
    expect(normalizeActivationCredential(" o1ab-lcid ")).toBe("01AB1C1D");

    expect(normalizeActivationCredential("o1ab lc id")).toBe("01AB1C1D");
  });

  it("preserves a legacy long activation token", () => {
    const legacy = "hM1zZs-FpQkLwV9e6j2R3x8N7c4B0aYuT5gD1sKpQwE";

    expect(normalizeActivationCredential(legacy)).toBe(legacy);
  });
});
