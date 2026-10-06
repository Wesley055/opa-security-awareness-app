"use client";
import { EnrollmentNextStep } from "@/components/auth/enrollment-next-step";
import { PasswordInput } from "@/components/auth/password-input";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, useEffect, useRef } from "react";
export default function EnrollPage() {
  return (
    <Suspense fallback={<p>Loading enrollment…</p>}>
      <EnrollmentForm />
    </Suspense>
  );
}
async function enrollmentRequest(init?: RequestInit) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch("/api/enroll", {
          ...init,
          cache: "no-store",
          signal: controller.signal,
        });
        return { response, result: await response.json() };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new Error(
              "Request deadline exceeded. Resume this invitation to determine its result.",
            ),
          );
        }, 15000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function EnrollmentForm() {
  const reference = useSearchParams().get("requestId") ?? "";
  const [stage, setStage] = useState("VERIFY"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [role, setRole] = useState(""),
    [requestId, setRequestId] = useState(reference);
  const submitting = useRef(false),
    edited = useRef(false);
  useEffect(() => {
    let alive = true;
    void enrollmentRequest()
      .then(({ response, result }) => {
        if (
          alive &&
          !edited.current &&
          response.ok &&
          result.status === "AUTHENTICATION_REQUIRED"
        ) {
          setStage(result.status);
          setRequestId(result.requestId ?? reference);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reference]);
  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 24 }}>
      <h1>Accept your OPA invitation</h1>
      <p>
        Use the request ID and verification codes delivered to your email and
        phone.
      </p>
      {stage === "ACCEPTED" ? (
        <section aria-label="Enrollment complete"><p role="status">Verification, password establishment and membership acceptance are complete.</p><EnrollmentNextStep role={role}/></section>

      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (submitting.current) return;
            submitting.current = true;
            edited.current = true;
            setBusy(true);
            setError("");
            const form = e.currentTarget;
            const body = Object.fromEntries(new FormData(form));
            try {
              if (
                stage === "VERIFY" &&
                body.password !== body.confirmPassword
              ) {
                setError("Passwords must match.");
                return;
              }
              delete body.confirmPassword;
              const { response, result } = await enrollmentRequest({
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...body,
                  accept: body.accept === "on",
                  action:
                    stage === "VERIFY"
                      ? "verify"
                      : stage === "RESUME"
                        ? "resume"
                        : "accept",
                  requestId,
                }),
                cache: "no-store",
              });
              if (!response.ok) {
                if (result.status === "RESULT_UNKNOWN") setStage("RESUME");
                setError(result.error || "Enrollment was rejected.");
                return;
              }
              if (result.status === "ACCEPTED") {
                form.reset();
                window.history.replaceState(window.history.state, "", window.location.pathname);
              }
              setRole(result.role ?? "");
              setStage(result.status);
            } catch (err) {
              setStage("RESUME");
              setError(
                err instanceof Error ? err.message : "Enrollment unavailable.",
              );
            } finally {
              submitting.current = false;
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} style={{ display: "grid", gap: 18 }}>
            {stage !== "AUTHENTICATION_REQUIRED" && (
              <label>
                Invitation reference
                <input
                  name="requestId"
                  value={requestId}
                  onChange={(e) => {
                    edited.current = true;
                    setRequestId(e.target.value);
                  }}
                  required
                />
              </label>
            )}
            {stage === "VERIFY" ? (
              <>
                <label>
                  Email verification code
                  <input
                    name="emailCode"
                    required
                    autoComplete="off"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <label>
                  Phone verification code
                  <input
                    name="phoneCode"
                    required
                    autoComplete="off"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <label>
                  Choose a password
                  <PasswordInput
                    key="new-enrollment-password"
                    aria-label="Choose a password"

                    name="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <label>
                  Confirm password
                  <PasswordInput
                    name="confirmPassword"
                    aria-label="Confirm password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </label>
                <p>
                  Set and confirm the password you will use to sign in. Both
                  proofs must pass before this password activates your account.
                  Any password supplied at registration is not your credential.
                </p>
                <label>
                  <input type="checkbox" name="accept" required /> I accept this
                  institutional membership.
                </label>
              </>
            ) : (
              <>
                <p>
                  {stage === "RESUME" ? (
                    "Resume only after completing both original proofs. Sign in with your own account, using the password chosen during verification if a new account was created. No new invitation or proof bypass is performed."
                  ) : (
                    <>
                      Both proofs are verified, but a separate account cannot be
                      created with these details. If you already have an OPA
                      account using these contact details, sign in to continue.
                      Otherwise, contact your administrator to arrange a new
                      enrollment with your own distinct contact details.
                    </>
                  )}
                </p>
                <label>
                  Email
                  <input
                    type="email"
                    name="email"
                    required
                    autoComplete="username"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
                <p>
                  <a href="/forgot-password">
                    Forgot password / recover access
                  </a>
                </p>
                <label>
                  Current password
                  <PasswordInput
                    key="existing-account-password"
                    aria-label="Current password"

                    name="password"
                    required
                    autoComplete="current-password"
                    style={{ display: "block", width: "100%" }}
                  />
                </label>
              </>
            )}
            <button>
              {busy
                ? "Processing…"
                : stage === "VERIFY"
                  ? "Verify and activate account"
                  : stage === "RESUME"
                    ? "Resume verified invitation"
                    : "Continue with an existing account"}
            </button>
            <button
              type="button"
              onClick={() => {
                edited.current = true;
                setStage(stage === "VERIFY" ? "RESUME" : "VERIFY");
                setError("");
              }}
            >
              {stage === "VERIFY"
                ? "Already verified or result uncertain? Resume"
                : "Return to original proof verification"}
            </button>
          </fieldset>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
