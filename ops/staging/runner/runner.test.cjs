"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const {verify, PATH, BIN} = require("./verify-toolchain.cjs");
const {signal} = require("./signal-cleanup.cjs");
const versions = {node: "v22.23.2", npm: "10.9.8", npx: "10.9.8"};
function run(file) {return {status: 0, stdout: versions[path.basename(file)] + "\n"};}
test("exact toolchain and deterministic absolute paths", () => {
  const result = verify(run, () => true, {PATH});
  for (const name of Object.keys(versions)) assert.deepEqual(result[name], {path: BIN + "/" + name, version: versions[name]});
});
for (const name of ["node","npm","npx"]) test("reject wrong " + name, () => {
  assert.throws(() => verify(file => path.basename(file) === name ? {status:0,stdout:"0.0.0"} : run(file), () => true, {PATH}), /VERSION_REJECTED/);
});
test("reject missing Node", () => assert.throws(() => verify(run, file => !file.endsWith("/node"), {PATH}), /TOOL_MISSING/));
test("reject nondeterministic or stripped job PATH", () => {
  for (const value of ["", "/usr/bin", PATH + ":/untrusted"]) assert.throws(() => verify(run, () => true, {PATH:value}), /PATH_REJECTED/);
});
test("cleanup signal needs neither job Node nor PATH nor checkout", () => {
  let saved;
  signal({GITHUB_RUN_ID:"1",GITHUB_SHA:"a".repeat(40),PATH:""}, (file,data,options) => {saved={file,data:JSON.parse(data),options};});
  assert.equal(saved.file,"/runner/opa-staging-job-finished.json");
  assert.equal(saved.options.mode,0o600);
  assert.deepEqual(saved.data,{runId:"1",sha:"a".repeat(40)});
});
test("cleanup refuses invalid identity and never serializes extra environment", () => {
  assert.throws(() => signal({GITHUB_RUN_ID:"bad",GITHUB_SHA:"a".repeat(40)}, () => {}));
  signal({GITHUB_RUN_ID:"1",GITHUB_SHA:"a".repeat(40),DATABASE_URL:"secret-marker"}, (_file,data) => assert.ok(!data.includes("secret-marker")));
});
test("workflow has no runtime toolchain download and cleanup is checkout independent", () => {
  const workflow=fs.readFileSync(path.resolve(__dirname,"../../../.github/workflows/opa-staging-migration-execution.yml"),"utf8");
  assert.ok(!workflow.includes("setup-node"));
  assert.ok(!/npm install --global|node-version:/.test(workflow));
  assert.ok(workflow.includes("run: /home/runner/externals/node24/bin/node /opt/opa/signal-cleanup.cjs"));
  assert.ok(workflow.indexOf("/opt/opa/verify-toolchain.cjs")<workflow.indexOf("actions/checkout@"));
  assert.ok(workflow.includes("environment: staging"));
  assert.ok(workflow.includes("if: always()"));
});
