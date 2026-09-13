// Execute only on a reviewed staging-network runner. No Azure login or provisioning.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs"),
  path = require("node:path");
const diagnostics = require("./staging-migration-diagnostics.cjs");
const {
  secretNames,
} = require("../../../packages/environment-policy/index.cjs");
async function run(options = {}) {
  const env = options.env || process.env,
    d = diagnostics.recorder();
  const secrets = Object.entries(env)
    .filter(
      ([name]) =>
        secretNames.includes(name) || /TOKEN|PASSWORD|SECRET/i.test(name),
    )
    .map(([, value]) => value);
  let failed;
  try {
    if (env.OPA_ENVIRONMENT !== "staging") throw Error("Staging required");
    const initialize =
      options.initialize ||
      require("../dist/shared/config/environment.js").initializeEnvironment;
    const observe = (stage, state = "start") => d.stage(stage, state);
    await initialize(true, "migration", observe);
    d.stage("prisma-command-start");
    const start = Date.now();
    const result = (options.spawn || spawnSync)(
      process.execPath,
      [
        (
          options.resolveCli || (() => require.resolve("prisma/build/index.js"))
        )(),
        "migrate",
        "deploy",
        "--schema",
        path.resolve(__dirname, "../prisma/schema.prisma"),
      ],
      { stdio: "pipe", env },
    );
    d.data.process = diagnostics.processResult(
      result,
      Date.now() - start,
      secrets,
    );
    d.stage("prisma-command-exit");
    if (result.status !== 0) throw Error("Prisma child failed");
    d.stage("prisma-command-exit", "passed");
    await initialize(false, "migration", observe);
    // Validation remains in the caller, as in the reviewed execution path.
    d.stage("prisma-validate", "skipped");
    d.data.status = "passed";
  } catch (error) {
    failed = error;
    d.failure(error, secrets);
  } finally {
    d.stage("cleanup");
    try {
      if (options.cleanup) await options.cleanup();
      d.data.cleanup = "passed";
      d.stage("cleanup", "passed");
    } catch (error) {
      d.data.cleanup = "failed";
      if (!failed) {
        failed = error;
        d.failure(error, secrets);
      } else d.stage("cleanup", "failed");
    }
  }
  const artifact = diagnostics.validate(d.data);
  if (options.write) options.write(artifact);
  else {
    const file =
      env.OPA_MIGRATION_DIAGNOSTICS_FILE ||
      path.join(
        env.RUNNER_TEMP || require("node:os").tmpdir(),
        "opa-staging-wrapper-diagnostics.json",
      );
    if (
      env.OPA_MIGRATION_DIAGNOSTICS_FILE &&
      file !== "/runner/opa-staging-wrapper-diagnostics.json"
    )
      throw Error("DIAGNOSTIC_PATH_REJECTED");
    fs.writeFileSync(file, JSON.stringify(artifact), { mode: 0o600 });
  }
  return { ok: !failed, diagnostic: diagnostics.validate(d.data) };
}
module.exports = { run };
if (require.main === module)
  run()
    .then((result) => {
      console.log(
        result.ok
          ? "Staging migration chain verified"
          : "Staging migration failed; sanitized diagnostics retained",
      );
      if (!result.ok) process.exitCode = 1;
    })
    .catch(() => {
      console.error("Staging migration diagnostics unavailable");
      process.exitCode = 1;
    });
