export class AuthResultUnknown extends Error {}
/** Deadline covers response body parsing too. Never log or persist authentication input. */
export async function authRequest(path: string, body: Record<string, unknown>) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
          signal: abort.signal,
        });
        const result = await response.json();
        if (response.status >= 500)
          throw new AuthResultUnknown(
            "Result unknown. Check your email or try signing in before retrying the same recovery action.",
          );
        if (!response.ok || !result.ok)
          throw Error(
            result.error ??
              "Request was not accepted. Review your details and retry.",
          );
        return result;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(
            new AuthResultUnknown(
              "Result unknown. The response deadline expired. Check your email or try signing in before retrying.",
            ),
          );
        }, 15000);
      }),
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      !(
        error instanceof TypeError ||
        error instanceof SyntaxError ||
        error.name === "AbortError"
      )
    )
      throw error;
    throw new AuthResultUnknown(
      "Result unknown. Check your connection and verify the outcome before retrying.",
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
