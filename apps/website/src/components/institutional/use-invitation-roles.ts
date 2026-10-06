"use client";
import { useEffect, useState } from "react";
export function useInvitationRoles(
  transport: (path: string) => Promise<Response>,
  facilityId: string,
  caseReference: string,
  enabled: boolean,
) {
  const scope = facilityId + ":" + caseReference;
  const [result, setResult] = useState<{
    scope: string;
    roles: string[];
    explanation: string;
  } | null>(null);
  const [previousScope, setPreviousScope] = useState(scope + enabled);
  if (previousScope !== scope + enabled) {
    setPreviousScope(scope + enabled);
    setResult(null);
  }
  useEffect(() => {
    if (!facilityId || !enabled) return;
    let alive = true,
      pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await transport(
          "facilities/" +
            facilityId +
            "/invitation-roles" +
            (caseReference ? "?caseReference=" + caseReference : ""),
        );
        if (!response.ok) throw Error();
        const data = await response.json();
        if (
          !Array.isArray(data.roles) ||
          data.roles.some(
            (r: unknown) =>
              !["USER", "FACILITY_ADMIN", "FACILITY_OPERATOR"].includes(
                String(r),
              ),
          )
        )
          throw Error();
        if (alive)
          setResult({
            scope,
            roles: data.roles,
            explanation: String(data.explanation ?? ""),
          });
      } catch {
        if (alive)
          setResult({
            scope,
            roles: [],
            explanation:
              "Invitation authority could not be confirmed. Use Refresh facility context or wait for the next authority check.",
          });
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [transport, facilityId, caseReference, enabled, scope]);
  return enabled && result?.scope === scope
    ? result
    : {
        roles: [],
        explanation: !enabled
          ? "Confirm current authority and select an assigned open Support Case."
          : "Checking current invitation eligibility…",
      };
}
