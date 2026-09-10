/** Inputs are already allowlisted database projections; never pass a complete User row. */
export function maskedPerson<T extends object>(person: T): T {
  const result = { ...person };
  for (const key of ['firstName', 'lastName', 'email', 'phoneNumber'] as const) {
    if (key in result) Object.assign(result, { [key]: '[protected]' });
  }
  return result;
}
