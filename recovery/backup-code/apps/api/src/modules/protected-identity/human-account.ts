import { createHash } from "node:crypto";
/** Authorized directory projection only: no contact data or decryption. */
export function humanAccount<
  T extends { id: string; firstName: string; lastName: string },
>(row: T) {
  const { firstName, lastName, ...safe } = row;
  const initial = (value: string) => /[\p{L}\p{N}]/u.exec(value)?.[0] ?? "?";
  const label = createHash("sha256")
    .update("opa-account-label:" + row.id)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  return {
    ...safe,
    displayIdentity:
      initial(firstName) +
      "••• " +
      initial(lastName) +
      "••• · Account " +
      label,
  };
}
