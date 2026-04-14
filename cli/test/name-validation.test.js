const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function withSandbox(run) {
  return async (t) => {
    const originalHome = os.homedir();
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skillbook-test-"));
    const fakeHome = path.join(sandbox, "home");
    const projectRoot = path.join(sandbox, "project");
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    process.env.HOME = fakeHome;

    for (const k of Object.keys(require.cache)) {
      if (k.includes("/cli/lib/")) delete require.cache[k];
    }

    try {
      await run(t, { sandbox, fakeHome, projectRoot });
    } finally {
      process.env.HOME = originalHome;
      for (const k of Object.keys(require.cache)) {
        if (k.includes("/cli/lib/")) delete require.cache[k];
      }
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  };
}

test("isValidName accepts safe names and rejects traversal/empty/invalid chars", () => {
  const store = require("../lib/store");
  for (const ok of ["code-review", "data_viz", "skill.v2", "a", "A1", "x".repeat(64)]) {
    assert.equal(store.isValidName(ok), true, `expected valid: ${ok}`);
  }
  for (const bad of ["", "..", ".hidden", "/abs", "../escape", "a/b", "a b", "a;rm", "_leading", "-leading", "x".repeat(65), null, undefined, 42]) {
    assert.equal(store.isValidName(bad), false, `expected invalid: ${JSON.stringify(bad)}`);
  }
});

test(
  "add rejects path-traversal names without writing to disk",
  withSandbox(async (_t, { fakeHome }) => {
    const commands = require("../lib/commands");
    const { STORE_DIR } = require("../lib/constants");

    commands.add(["../escape"]);

    assert.equal(
      fs.existsSync(path.join(STORE_DIR, "../escape")),
      false,
      "must not create directory outside store",
    );
    assert.equal(
      fs.existsSync(path.join(path.dirname(STORE_DIR), "escape")),
      false,
      "must not escape into ~/.skillbook/",
    );
    assert.ok(fakeHome);
  }),
);

test(
  "create rejects invalid set name and invalid skill names in --skills",
  withSandbox(async (_t, { projectRoot }) => {
    process.chdir(projectRoot);
    const commands = require("../lib/commands");
    const { SETS_DIR } = require("../lib/constants");

    commands.create(["../bad", "--skills", "alpha"]);
    assert.equal(fs.existsSync(path.join(SETS_DIR, "../bad.json")), false);

    commands.create(["good", "--skills", "alpha,../evil"]);
    assert.equal(
      fs.existsSync(path.join(SETS_DIR, "good.json")),
      false,
      "set must not be saved when any skill name is invalid",
    );
  }),
);
