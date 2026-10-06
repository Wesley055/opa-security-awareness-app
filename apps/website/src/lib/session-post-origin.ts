/** CSRF check for browser session POSTs, including no-referrer HTML forms.
 * Fetch Metadata is browser-controlled. Never trust forwarded host headers here.
 */
export function sameOriginSessionPost(request: Request): boolean {
  if (request.method !== "POST") return false;
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const site = request.headers.get("sec-fetch-site");
  const mode = request.headers.get("sec-fetch-mode");
  const dest = request.headers.get("sec-fetch-dest");
  // Same-site is not same-origin; sibling hosts and different ports are untrusted.
  if (site !== null && site !== "same-origin") return false;
  if (origin !== null && origin !== "null" && origin !== expected) return false;
  if (referer !== null) {
    try {
      if (new URL(referer).origin !== expected) return false;
    } catch {
      return false;
    }
  }
  if (mode !== null && !["navigate", "cors", "same-origin"].includes(mode)) return false;
  if (dest !== null && !["document", "empty"].includes(dest)) return false;
  if ((mode === "navigate" && dest !== null && dest !== "document") ||
      (mode !== null && mode !== "navigate" && dest === "document")) return false;
  // Privacy policy may redact Origin to null. Only a same-origin top-level form
  // with complete browser metadata can authorize that opaque-origin case.
  if (origin === "null")
    return site === "same-origin" && mode === "navigate" && dest === "document";
  if (origin === expected || referer !== null) return true;
  return site === "same-origin" && mode === "navigate" && dest === "document";
}
