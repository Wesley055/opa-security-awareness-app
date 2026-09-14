"use strict";
const fs = require("node:fs"), cp = require("node:child_process");
const BIN = "/opt/opa/node22/bin";
const PATH = BIN + ":/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
function verify(run = cp.spawnSync, exists = fs.existsSync, env = process.env) {
  if (env.PATH !== PATH) throw new Error("RUNNER_PATH_REJECTED");
  const expected = {node: "v22.23.2", npm: "10.9.8", npx: "10.9.8"};
  const result = {};
  for (const [name, version] of Object.entries(expected)) {
    const file = BIN + "/" + name;
    if (!exists(file)) throw new Error("RUNNER_TOOL_MISSING");
    const r = run(file, ["--version"], {env: {...env, PATH}, encoding: "utf8", timeout: 15000});
    if (r.error || r.signal || r.status !== 0 || r.stdout.trim() !== version) throw new Error("RUNNER_VERSION_REJECTED");
    result[name] = {path: file, version};
  }
  return result;
}
if (require.main === module) {
  try { console.log(JSON.stringify(verify())); }
  catch { console.error("RUNNER_TOOLCHAIN_REJECTED"); process.exitCode = 1; }
}
module.exports = {verify, BIN, PATH};
