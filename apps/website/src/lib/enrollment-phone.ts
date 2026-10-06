import { parsePhoneNumberFromString } from "libphonenumber-js";
// Client convenience only: EnrollmentService remains the authoritative validator.
export function normalizeEnrollmentPhone(input: string): string {
  const compact = input.trim().replace(/[\s()-]/g, "");
  if (!/^\+?\d+$/.test(compact) || /^(?:\+234|234)0/.test(compact))
    throw new Error("Enter a valid phone number.");
  const candidate = /^234\d+$/.test(compact) ? "+" + compact : compact;
  const phone = parsePhoneNumberFromString(candidate, "NG");
  if (!phone?.isValid()) throw new Error("Enter a valid phone number.");
  return phone.number;
}
