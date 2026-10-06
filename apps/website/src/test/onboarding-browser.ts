import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, expect } from "@playwright/test";

type Input = {
  api: string;
  support: { id: string; email: string };
  admin: { id: string; email: string };
  password: string;
  facility: string;
  other: string;
  revoke: () => Promise<void>;
  regrant: () => Promise<void>;
  audit: (requestId: string) => Promise<void>;
};
async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
// Opt-in real browser verification. Only the integration harness's disposable _test
// database is used. No provider worker is started and no message is delivered.
export async function runOnboardingBrowser(input: Input) {
  const cwd = resolve(__dirname, "../.."),
    port = await unusedPort(),
    origin = "http://localhost:" + port;
  const nextEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development",
    OPA_ENVIRONMENT: "development",
    OPA_API_BASE_URL: input.api,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  // Next is a standalone Node process, not a Jest worker. On Windows Next
  // intentionally handles ESM config imports differently inside Jest.
  delete nextEnv.JEST_WORKER_ID;
  const child = spawn(
    process.execPath,
    [
      resolve(cwd, "node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "--hostname",
      "localhost",
      "--port",
      String(port),
    ],
    {
      cwd,
      windowsHide: true,
      env: nextEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output = (output + chunk).slice(0, 16000);
  });
  child.stderr.on("data", (chunk) => {
    output = (output + chunk).slice(0, 16000);
  });
  let browser: Browser | undefined;
  try {
    const deadline = Date.now() + 120000;
    while (true) {
      try {
        if (
          (
            await fetch(origin + "/onboarding/login", {
              signal: AbortSignal.timeout(60000),
            })
          ).ok
        )
          break;
      } catch {
        /* Wait for this isolated Next server. */
      }
      if (Date.now() > deadline || child.exitCode !== null)
        throw new Error("Isolated website did not become ready: " + output);
      await new Promise((r) => setTimeout(r, 500));
    }
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const login = async (target: typeof page, person: { email: string }) => {
      await target.goto(origin + "/onboarding/login");
      try {
        await target.getByLabel("Email", { exact: true }).waitFor();
      } catch {
        throw new Error(
          "Isolated login did not render: " +
            (await target.locator("body").innerText()).slice(0, 2000) +
            "\n" +
            output,
        );
      }
      await target.getByLabel("Email", { exact: true }).fill(person.email);
      await target.getByLabel("Password", { exact: true }).fill(input.password);
      const loggedIn = target.waitForResponse(
        (r) =>
          r.url() === origin + "/api/onboarding/login" &&
          r.request().method() === "POST",
      );
      await target
        .getByRole("button", { name: "Sign in", exact: true })
        .click();
      const result = await loggedIn;
      console.log("[browser-acceptance] login HTTP " + result.status());
      if (!result.ok())
        throw new Error(
          "Isolated login rejected: " +
            result.status() +
            " " +
            (await result.text()) +
            "\n" +
            output,
        );
      await target.waitForURL(origin + "/onboarding", {
        waitUntil: "domcontentloaded",
      });
    };
    // Capture the first enumeration after the actual password login, with its DB actor.
    const enumerated = page.waitForResponse(
      (r) =>
        r.url() === origin + "/api/onboarding/facilities" &&
        r.request().method() === "GET",
      { timeout: 120000 },
    );
    void enumerated.catch(() => {});
    await login(page, input.support);
    const initial = await enumerated;
    expect(initial.status()).toBe(200);
    const scope = await initial.json();
    expect(scope.actor).toEqual({ id: input.support.id, role: "USER" });
    expect(scope.facilities).toEqual([
      { id: input.facility, name: "Authorized" },
    ]);
    await page
      .getByRole("option", { name: "Authorized", exact: true })
      .waitFor({ state: "attached" });
    expect(
      await page.getByRole("option", { name: "Other", exact: true }).count(),
    ).toBe(0);
    const headers = { "x-onboarding-actor": input.support.id + ":USER" };
    const a = await context.request.get(
      origin + "/api/onboarding/facilities/" + input.facility + "/invitations",
      { headers },
    );
    expect(a.status()).toBe(200);
    const b = await context.request.get(
      origin + "/api/onboarding/facilities/" + input.other + "/invitations",
      { headers },
    );
    expect(b.status()).toBe(403);
    // Also call the API directly with the existing session token: proxy denial alone
    // cannot establish server-side tenant isolation. Never print the token.
    const access = (await context.cookies()).find(
      (c) => c.name === "opa_onboarding_access",
    )!.value;
    const directHeaders = { Authorization: "Bearer " + access };
    expect(
      (
        await fetch(
          input.api + "/onboarding/facilities/" + input.other + "/invitations",
          { headers: directHeaders },
        )
      ).status,
    ).toBe(403);
    await page.getByLabel("Authorized facility").selectOption(input.facility);
    await page.getByRole("heading", { name: "Invite staff" }).waitFor();
    const invitation = await context.request.post(
      origin + "/api/onboarding/operators",
      {
        headers: { ...headers, origin, "Idempotency-Key": randomUUID() },
        data: {
          facilityId: input.facility,
          firstName: "Synthetic",
          lastName: "Acceptance",
          email: randomUUID() + "@example.test",
          phoneNumber:
            "+23480" + String(Math.random()).slice(2, 10).padEnd(8, "0"),
        },
      },
    );
    expect(invitation.status()).toBe(200);
    const receipt = await invitation.json();
    await input.revoke();
    expect(
      (
        await fetch(
          input.api +
            "/onboarding/facilities/" +
            input.facility +
            "/invitations",
          { headers: directHeaders },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await context.request.get(
          origin +
            "/api/onboarding/facilities/" +
            input.facility +
            "/invitations",
          { headers },
        )
      ).status(),
    ).toBe(403);
    await page.getByText("No authorized facilities are available.").waitFor();
    expect(
      await page.getByRole("heading", { name: "Invite staff" }).count(),
    ).toBe(0);
    expect(await page.getByLabel("Authorized facility").inputValue()).toBe("");
    await input.audit(receipt.requestId);
    // ADMIN needs no grant. Switching the onboarding cookie in another tab must
    // invalidate ADMIN-era rendered facilities without a reload of that workspace.
    await login(page, input.admin);
    await page
      .getByRole("option", { name: "Other", exact: true })
      .waitFor({ state: "attached" });
    await page.getByLabel("Authorized facility").selectOption(input.other);
    await input.regrant();
    const second = await context.newPage();
    await login(second, input.support);
    await page.bringToFront();
    await page.waitForFunction(
      (id) =>
        document.querySelector("[role=status]")?.textContent?.includes(id),
      input.support.id,
    );
    expect(
      await page.getByRole("option", { name: "Other", exact: true }).count(),
    ).toBe(0);
    expect(await page.getByLabel("Authorized facility").inputValue()).toBe("");
    const stale = await context.request.get(
      origin + "/api/onboarding/facilities/" + input.other + "/invitations",
      { headers: { "x-onboarding-actor": input.admin.id + ":ADMIN" } },
    );
    expect(stale.status()).toBe(403);
    console.log(
      "[browser-acceptance] " +
        JSON.stringify({
          actor: scope.actor,
          initialFacilities: scope.facilities,
          facilityA: 200,
          facilityBProxy: 403,
          facilityBApi: 403,
          revokedAApi: 403,
          revokedAProxy: 403,
          renderedStateCleared: true,
          adminGrantFree: true,
          actorSwitchCleared: true,
          staleActorProxy: 403,
          audit: "PASS",
          isolatedOrigin: origin,
        }),
    );
    await context.close();
  } finally {
    await browser?.close();
    if (child.pid && child.exitCode === null) {
      if (process.platform === "win32")
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else child.kill();
    }
  }
}
