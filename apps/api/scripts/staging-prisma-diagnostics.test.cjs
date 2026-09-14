"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { instrument } = require("./staging-prisma-diagnostics.cjs");
test("keeps results, receiver and arguments unchanged", async () => {
  const rows = [];
  const engine = {
    value: 7,
    async start(x) {
      assert.equal(this.value, 7);
      return x;
    },
    async transaction(action, x) {
      return { action, x };
    },
  };
  instrument(engine, (x) => rows.push(x));
  assert.equal(await engine.start(42), 42);
  assert.deepEqual(await engine.transaction("start", 8), {
    action: "start",
    x: 8,
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => x.durationMs >= 0));
});
test("preserves same connection exception and emits metadata only", async () => {
  const rows = [];
  const error = Object.assign(new Error("DATABASE_URL secret query text"), {
    code: "P1001",
    meta: { code: "08006" },
  });
  const engine = {
    async start() {
      throw error;
    },
  };
  instrument(engine, (x) => rows.push(x));
  await assert.rejects(engine.start(), (e) => e === error);
  assert.equal(rows[0].prismaCode, "P1001");
  assert.equal(rows[0].sqlstate, "08006");
  assert.doesNotMatch(JSON.stringify(rows), /DATABASE_URL|secret|query text/);
});
test("does not treat commit or rollback as transaction acquisition", async () => {
  const rows = [];
  const engine = {
    async transaction(a) {
      return a;
    },
  };
  instrument(engine, (x) => rows.push(x));
  await engine.transaction("commit");
  await engine.transaction("rollback");
  assert.deepEqual(rows, []);
});
