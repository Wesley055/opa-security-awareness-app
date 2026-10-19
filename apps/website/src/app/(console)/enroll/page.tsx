"use client";
import { EnrollmentNextStep } from "@/components/auth/enrollment-next-step";
import { PasswordInput } from "@/components/auth/password-input";
import { useSearchParams } from "next/navigation";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/password-rule";
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
    <main className="opa-enroll" style={{ maxWidth: 560, margin: "40px auto", padding: 24 }}>
      <style>{`
        .opa-enroll label { display: grid; gap: 6px; font-weight: 600; }
        .opa-enroll input:not([type=checkbox]) { display: block; width: 100%; box-sizing: border-box; background: #fff; color: #08111a; border: 1px solid #94a3b8; border-radius: 8px; padding: 12px 14px; font-size: 16px; }
        .opa-enroll input:focus { outline: 3px solid #17c964; outline-offset: 1px; }
        .opa-enroll button.opa-primary { background: #17c964; color: #08111a; font-weight: 700; font-size: 16px; border: 0; border-radius: 8px; padding: 14px 16px; cursor: pointer; }
        .opa-enroll button.opa-secondary { background: none; border: 0; color: #5eead4; text-decoration: underline; font-size: 15px; cursor: pointer; padding: 8px 0; }
        .opa-enroll [role=alert] { color: #ff7b72; font-weight: 600; }
      `}</style>
      <h1>Accept your OPA invitation</h1>
      <p>
        We sent a 4-digit code to your email and another to your phone. Enter
        both below, then choose your password.
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
              if (stage === "VERIFY") {
                const problem = passwordProblem(String(body.password ?? ""));
                if (problem) {
                  setError(problem);
                  return;
                }
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
            {stage !== "AUTHENTICATION_REQUIRED" && !reference && (
              <label>
                Invitation reference (from your message, e.g. OPA-3F9A1C)
                <input
                  name="requestId"
                  placeholder="OPA-XXXXXX"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
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
                  Code from your email
                  <input
                    name="emailCode"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="4 digits"
                    style={{ display: "block", width: "100%", fontSize: 24, letterSpacing: 8 }}
                  />
                </label>
                <label>
                  Code from your phone (SMS)
                  <input
                    name="phoneCode"
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="4 digits"
                    style={{ display: "block", width: "100%", fontSize: 24, letterSpacing: 8 }}
                  />
                </label>
                <label>
                  Choose a password
                  <PasswordInput
                    key="new-enrollment-password"
                    aria-label="Choose a password"

                    name="password"
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                    maxLength={PASSWORD_MAX_LENGTH}
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
                    minLength={PASSWORD_MIN_LENGTH}
                    maxLength={PASSWORD_MAX_LENGTH}
                    autoComplete="new-password"
                  />
                </label>
                <p>{PASSWORD_RULE_TEXT} You will use it to sign in.</p>
                <label>
                  <input type="checkbox" name="accept" required /> I accept this
                  invitation.
                </label>
              </>
            ) : (
              <>
                <p>
                  {stage === "RESUME" ? (
                    "Already entered both codes? Your codes are used once, so they are not needed again. Sign in with the email and the password you chose to finish."
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
            <button className="opa-primary">
              {busy
                ? "Processing…"
                : stage === "VERIFY"
                  ? "Verify and create my account"
                  : stage === "RESUME"
                    ? "Sign in and finish"
                    : "Sign in to accept the invitation"}
            </button>
            <button
              type="button"
              className="opa-secondary"
              onClick={() => {
                edited.current = true;
                setStage(stage === "VERIFY" ? "RESUME" : "VERIFY");
                setError("");
              }}
            >
              {stage === "VERIFY"
                ? "Already entered both codes? Sign in to finish"
                : "Back to entering my codes"}
            </button>
          </fieldset>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
