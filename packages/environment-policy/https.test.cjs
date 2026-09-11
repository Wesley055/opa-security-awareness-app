const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { probeEndpoint } = require("./verify-endpoint.cjs");
function transport(status, body, error) {
  return {
    get(url, options, callback) {
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(url, "https://staging.example.test/health/environment");
      const request = new EventEmitter();
      request.destroy = (e) => request.emit("error", e);
      queueMicrotask(() => {
        if (error) {
          request.emit("error", Error(error));
          return;
        }
        const response = new EventEmitter();
        response.statusCode = status;
        response.destroy = () => {};
        callback(response);
        response.emit("data", JSON.stringify(body));
        response.emit("end");
      });
      return request;
    },
  };
}
test("HTTPS verified staging fixture succeeds", async () => {
  await probeEndpoint(
    "https://staging.example.test",
    "staging",
    "fixture",
    transport(200, {
      environment: "staging",
      build: "fixture",
      migrationReadiness: "ready",
    }),
  );
});
test("invalid TLS certificate fails", async () => {
  await assert.rejects(
    probeEndpoint(
      "https://staging.example.test",
      "staging",
      "fixture",
      transport(null, null, "CERT_HAS_EXPIRED"),
    ),
  );
});
for (const [name, status, body] of [
  [
    "redirect",
    302,
    { environment: "staging", build: "fixture", migrationReadiness: "ready" },
  ],
  [
    "production classification",
    200,
    {
      environment: "production",
      build: "fixture",
      migrationReadiness: "ready",
    },
  ],
  [
    "wrong build",
    200,
    { environment: "staging", build: "other", migrationReadiness: "ready" },
  ],
  [
    "pending migrations",
    200,
    { environment: "staging", build: "fixture", migrationReadiness: "pending" },
  ],
])
  test(name + " fails", async () =>
    assert.rejects(
      probeEndpoint(
        "https://staging.example.test",
        "staging",
        "fixture",
        transport(status, body),
      ),
    ),
  );
