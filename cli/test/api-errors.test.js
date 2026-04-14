const test = require("node:test");
const assert = require("node:assert");

function run(res, body) {
  const { _internal } = require("../lib/commands");
  return new Promise((resolve, reject) => _internal.settleResponse(res, body, resolve, reject));
}

test("settleResponse rejects non-2xx with HTTP status and body excerpt", async () => {
  const err = await run({ statusCode: 500, statusMessage: "Internal Server Error" }, "<html><body>boom</body></html>")
    .then(() => null, (e) => e);
  assert.ok(err, "should reject");
  assert.match(err.message, /HTTP 500/);
  assert.match(err.message, /Internal Server Error/);
  assert.match(err.message, /boom/);
});

test("settleResponse rejects 401 with body excerpt", async () => {
  const err = await run({ statusCode: 401, statusMessage: "Unauthorized" }, '{"error":"bad token"}')
    .then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /HTTP 401/);
  assert.match(err.message, /bad token/);
});

test("settleResponse resolves on 200 with valid JSON", async () => {
  const result = await run({ statusCode: 200 }, '{"ok":true,"n":42}');
  assert.deepEqual(result, { ok: true, n: 42 });
});

test("settleResponse rejects 200 + non-JSON with status and excerpt", async () => {
  const err = await run({ statusCode: 200 }, "<html>not json</html>")
    .then(() => null, (e) => e);
  assert.ok(err);
  assert.match(err.message, /Invalid JSON response/);
  assert.match(err.message, /status 200/);
  assert.match(err.message, /not json/);
});
