"use strict";
const fs = require("node:fs");
function signal(env = process.env, write = fs.writeFileSync) {
  if (!/^\d+$/.test(env.GITHUB_RUN_ID || "") || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || "")) throw new Error("CLEANUP_IDENTITY_REQUIRED");
  write("/runner/opa-staging-job-finished.json", JSON.stringify({runId: env.GITHUB_RUN_ID, sha: env.GITHUB_SHA}), {mode: 0o600});
}
if (require.main === module) {
  try { signal(); } catch { console.error("CLEANUP_SIGNAL_FAILED"); process.exitCode = 1; }
}
module.exports = {signal};
