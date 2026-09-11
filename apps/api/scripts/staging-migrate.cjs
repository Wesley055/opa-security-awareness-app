// Execute only on a reviewed staging-network runner. No Azure login or provisioning.
const { spawnSync } = require("node:child_process");
async function run() {
  if (process.env.OPA_ENVIRONMENT !== "staging")
    throw Error("Staging required");
  const {
    initializeEnvironment,
  } = require("../dist/shared/config/environment.js");
  await initializeEnvironment(true, "migration");
  const cli = require.resolve("prisma/build/index.js");
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "migrate",
      "deploy",
      "--schema",
      require("node:path").resolve(__dirname, "../prisma/schema.prisma"),
    ],
    { stdio: "pipe", env: process.env },
  );
  // Prisma output may contain a connection identity; emit only neutral status.
  if (result.status !== 0) throw Error("Staging migration failed");
  await initializeEnvironment(false, "migration");
  console.log("Staging migration chain verified");
}
run().catch(() => {
  console.error("Staging migration preflight or migration failed");
  process.exitCode = 1;
});
