/**
 * tsconfig has noUncheckedIndexedAccess, so rows[0] is T | undefined.
 *
 * A non-null assertion would silence that; this instead turns an empty
 * result set into a named error at the point it happens, rather than an
 * undefined that fails somewhere less obvious.
 */
export function firstRow<T>(rows: T[], context = 'query'): T {
  const row = rows[0];

  if (row === undefined) {
    throw new Error('Expected at least one row from ' + context + ', got none.');
  }

  return row;
}
