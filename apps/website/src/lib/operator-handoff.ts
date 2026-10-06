import "server-only";
import {
  institutionalTokens,
  setInstitutionalSession,
  clearInstitutionalSession,
} from "./institutional-session";
import { AdminFailure, upstream } from "./super-admin-api";
import { setOperatorSession, clearOperatorSession } from "./operator-session";
/** Called only inside /api/institutional so the path-scoped refresh cookie is actually sent. */
export async function operatorHandoff() {
  const tokens = await institutionalTokens();
  let access = tokens.accessToken;
  const refresh = tokens.refreshToken;
  try {
    if (!refresh) throw new AdminFailure(401);
    let context;
    let rotated: { accessToken: string; refreshToken: string } | undefined;
    try {
      if (!access) throw new AdminFailure(401);
      context = await upstream("/institutional/context", access);
    } catch (error) {
      if (!(error instanceof AdminFailure) || error.status !== 401) throw error;
      const result = await upstream("/auth/refresh", undefined, {
        refreshToken: refresh,
      });
      if (
        typeof result.accessToken !== "string" ||
        typeof result.refreshToken !== "string"
      )
        throw new AdminFailure(502);
      rotated = result;
      access = result.accessToken;
      context = await upstream("/institutional/context", access);
    }
    if (
      context?.actor?.role !== "FACILITY_OPERATOR" ||
      !context.actor.id ||
      !Array.isArray(context.facilities) ||
      context.facilities.length !== 1 ||
      !context.facilities[0]?.id
    )
      throw new AdminFailure(403);
    if (rotated)
      await setInstitutionalSession(rotated.accessToken, rotated.refreshToken);
    await setOperatorSession({
      accessToken: access!,
      refreshToken: rotated?.refreshToken ?? refresh,
    });
    return {
      ok: true as const,
      facilityId: context.facilities[0].id as string,
    };
  } catch (error) {
    if (error instanceof AdminFailure && [401, 403].includes(error.status)) {
      await clearOperatorSession();
      if (error.status === 401) await clearInstitutionalSession();
    }
    throw error;
  }
}
