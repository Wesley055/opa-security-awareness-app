/** Mirrors the API rule. The API remains the authority. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
export const PASSWORD_RULE_TEXT =
  "Use 8 to 64 characters, with letters and at least one number or symbol.";
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return PASSWORD_RULE_TEXT;
  if (!/\p{L}/u.test(password) || !/[\p{N}\p{P}\p{S}]/u.test(password)) return PASSWORD_RULE_TEXT;
  return null;
}
