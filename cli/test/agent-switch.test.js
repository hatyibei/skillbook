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

function seedSkill(storeDir, name) {
  const dir = path.join(storeDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n\n# ${name}\n`);
}

test(
  "agent switch cleans up old agent's skills dir and equips into the new one",
  withSandbox(async (_t, { projectRoot }) => {
    process.chdir(projectRoot);
    const { STORE_DIR } = require("../lib/constants");
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    store.ensureDirs();
    const config = store.readConfig();
    config.projectRoot = projectRoot;
    config.agent = "claude-code";
    store.writeConfig(config);

    seedSkill(STORE_DIR, "alpha");
    store.saveSet("s", { description: "", skills: ["alpha"], agents: ["claude-code", "codex"] });
    commands.equip(["s"]);

    const claudeLink = path.join(projectRoot, ".claude", "skills", "alpha");
    const codexLink = path.join(projectRoot, ".codex", "skills", "alpha");

    assert.ok(fs.existsSync(claudeLink), "precondition: claude-code link exists");

    commands.agent(["codex"]);

    assert.equal(
      fs.existsSync(claudeLink),
      false,
      "old agent's symlink must be cleaned up after switching",
    );
    assert.ok(
      fs.existsSync(codexLink),
      "new agent must be equipped with the same set",
    );
    assert.ok(
      fs.lstatSync(codexLink).isSymbolicLink(),
      "new entry must be a symlink",
    );

    const after = store.readConfig();
    assert.equal(after.agent, "codex");
    assert.equal(after.activeSet, "s", "activeSet must be restored after re-equip");
  }),
);

test(
  "agent switch preserves user-created files in the old skills dir",
  withSandbox(async (_t, { projectRoot }) => {
    process.chdir(projectRoot);
    const { STORE_DIR } = require("../lib/constants");
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    store.ensureDirs();
    const config = store.readConfig();
    config.projectRoot = projectRoot;
    config.agent = "claude-code";
    store.writeConfig(config);

    seedSkill(STORE_DIR, "alpha");
    store.saveSet("s", { description: "", skills: ["alpha"], agents: ["claude-code"] });
    commands.equip(["s"]);

    const userDir = path.join(projectRoot, ".claude", "skills", "user-owned");
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, "SKILL.md"), "# mine\n");

    commands.agent(["codex"]);

    assert.ok(fs.existsSync(userDir), "user's own dir must survive agent switch");
    assert.ok(fs.existsSync(path.join(userDir, "SKILL.md")));
  }),
);
