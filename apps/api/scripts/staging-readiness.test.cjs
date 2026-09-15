"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const r = require("./staging-readiness.cjs");
const transient = () =>
  Object.assign(Error("cannot reach database"), {
    name: "PrismaClientInitializationError",
    errorCode: "P1001",
  });
function setup(errors = []) {
  let time = 0,
    calls = 0,
    disconnects = 0;
  const events = [],
    sleeps = [];
  const client = {
    $connect: async () => {
      calls++;
      if (errors.length) throw errors.shift();
    },
    $disconnect: async () => {
      disconnects++;
    },
    $transaction: () => {
      throw Error("TRANSACTION_INVOKED");
    },
  };
  const session = r.session({
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    emit: (e) => events.push(e),
  });
  return {
    client,
    session,
    events,
    sleeps,
    calls: () => calls,
    disconnects: () => disconnects,
    advance: (n) => (time += n),
  };
}
test("transient recovery logs initial failure and recovery, no silent retries", async () => {
  const f = setup([transient()]);
  await f.session.connect(f.client);
  assert.equal(f.calls(), 2);
  assert.deepEqual(f.sleeps, [500]);
  assert.deepEqual(
    f.events.map((e) => e.event),
    ["failed", "recovered"],
  );
  assert.equal(f.disconnects(), 1);
});
test("three total attempts maximum with exact backoff", async () => {
  const f = setup([transient(), transient(), transient(), transient()]);
  await assert.rejects(f.session.connect(f.client), /READINESS_P1001/);
  assert.equal(f.calls(), 3);
  assert.deepEqual(f.sleeps, [500, 1500]);
});
for (const [name, code] of [
  ["authentication", "P1000"],
  ["authorization", "P1010"],
  ["TLS certificate", "CERT_HAS_EXPIRED"],
  ["identity", "P1001"],
  ["wrong database", "P1003"],
  ["sentinel", "P1001"],
  ["configuration", "P1012"],
  ["assertion", "ERR_ASSERTION"],
  ["constraint", "P2002"],
  ["transaction", "P2028"],
  ["PII security", "DENIED"],
  ["SafeWalk logic", "LOGIC"],
  ["Incident logic", "LOGIC"],
])
  test(name + " never retried", async () => {
    const e = Object.assign(Error(name), { code }),
      f = setup([e]);
    await assert.rejects(f.session.connect(f.client));
    assert.equal(f.calls(), 1);
    assert.equal(f.sleeps.length, 0);
  });
test("20-second overall deadline includes retry waiting and is shared across clients", async () => {
  const f = setup();
  f.advance(20000);
  await assert.rejects(f.session.connect(f.client), /DEADLINE/);
  assert.equal(f.calls(), 0);
  assert.equal(r.DEADLINE_MS, 20000);
});
test("slow connect reaching deadline cannot release fixtures or retry", async () => {
  const f = setup();
  f.client.$connect = async () => f.advance(20001);
  await assert.rejects(f.session.connect(f.client), /DEADLINE/);
  assert.throws(() => f.session.beginFixtures(), /PHASE/);
  assert.equal(f.sleeps.length, 0);
});
test("assertions and application transactions cannot be replayed after phase fence", async () => {
  const f = setup();
  await f.session.connect(f.client);
  f.session.beginFixtures();
  await assert.rejects(f.session.connect(f.client), /PHASE/);
  assert.equal(f.calls(), 1);
});
test("failed disposal prevents another connect", async () => {
  const f = setup([transient()]);
  f.client.$disconnect = async () => {
    throw Error("disconnect");
  };
  await assert.rejects(f.session.connect(f.client), /CLEANUP/);
  assert.equal(f.calls(), 1);
});
test("messages/credentials/SQL never emitted", async () => {
  const e = transient();
  e.message = "postgresql://synthetic:VERY_SECRET@host/db SELECT private_value";
  const f = setup([e]);
  await f.session.connect(f.client);
  assert.ok(!JSON.stringify(f.events).includes("VERY_SECRET"));
  assert.ok(!JSON.stringify(f.events).includes("SELECT"));
});
test("normal connection performs no query, fixture, assertion or transaction callback", async () => {
  const f = setup();
  await f.session.connect(f.client);
  assert.equal(f.calls(), 1);
  assert.deepEqual(
    f.events.map((e) => e.event),
    ["ready"],
  );
});

test("fixture fence rejects pending readiness and concurrent connect", async () => {
  const f = setup();
  let resolve;
  f.client.$connect = () => new Promise((r) => (resolve = r));
  const pending = f.session.connect(f.client);
  await Promise.resolve();
  assert.throws(() => f.session.beginFixtures(), /PHASE/);
  await assert.rejects(f.session.connect(f.client), /PHASE/);
  resolve();
  await pending;
  f.session.beginFixtures();
});

test("identity/sentinel verification is bounded and never replayed", async () => {
  const f = setup();
  await f.session.connect(f.client);
  const error = Object.assign(Error("sentinel mismatch"), { code: "P1001" });
  await assert.rejects(
    f.session.verifyIdentity(Promise.reject(error)),
    /sentinel/,
  );
  assert.equal(f.calls(), 1);
  assert.equal(f.sleeps.length, 0);
  assert.throws(() => f.session.beginFixtures(), /PHASE/);
});
test("identity verification shares the original 20-second deadline", async () => {
  const f = setup();
  await f.session.connect(f.client);
  f.advance(20000);
  await assert.rejects(f.session.verifyIdentity(Promise.resolve()), /DEADLINE/);
  assert.throws(() => f.session.beginFixtures(), /PHASE/);
});
