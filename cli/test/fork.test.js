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

test(
  "fork must not overwrite an existing set without --force",
  withSandbox(async (_t, { projectRoot }) => {
    process.chdir(projectRoot);
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    store.saveSet("dev", { description: "original", skills: ["a"], agents: ["claude-code"] });
    store.saveSet("target", { description: "do-not-touch", skills: ["x"], agents: ["claude-code"] });

    commands.fork(["dev", "--name", "target"]);

    const target = store.getSet("target");
    assert.equal(target.description, "do-not-touch", "existing set must remain intact");
    assert.deepEqual(target.skills, ["x"], "existing set's skills must remain intact");
    assert.equal(target.forkedFrom, undefined, "must not gain forkedFrom marker");
  }),
);

test(
  "fork --force overwrites an existing set with forkedFrom marker",
  withSandbox(async (_t, { projectRoot }) => {
    process.chdir(projectRoot);
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    store.saveSet("dev", { description: "original", skills: ["a"], agents: ["claude-code"] });
    store.saveSet("target", { description: "old", skills: ["x"], agents: ["claude-code"] });

    commands.fork(["dev", "--name", "target", "--force", "true"]);

    const target = store.getSet("target");
    assert.equal(target.description, "original");
    assert.deepEqual(target.skills, ["a"]);
    assert.equal(target.forkedFrom, "dev");
  }),
);

test(
  "fork into a new name still succeeds (regression)",
  withSandbox(async (_t, { projectRoot }) => {
    process.chdir(projectRoot);
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    store.saveSet("dev", { description: "original", skills: ["a"], agents: ["claude-code"] });
    commands.fork(["dev", "--name", "dev2"]);

    const forked = store.getSet("dev2");
    assert.ok(forked, "new set must exist");
    assert.equal(forked.forkedFrom, "dev");
    assert.deepEqual(forked.skills, ["a"]);
  }),
);
