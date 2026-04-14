const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate ~/.skillbook per-test by redirecting HOME before requiring modules.
function withSandbox(run) {
  return async (t) => {
    const originalHome = os.homedir();
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skillbook-test-"));
    const fakeHome = path.join(sandbox, "home");
    const projectRoot = path.join(sandbox, "project");
    fs.mkdirSync(fakeHome, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });
    process.env.HOME = fakeHome;

    // Clear require cache so constants re-evaluate against new HOME.
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

function seedSkill(storeDir, name, body = "# test skill\n") {
  const dir = path.join(storeDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\n---\n\n${body}`,
  );
}

test(
  "equip should remove legacy `<skill>.md` regular files before relinking",
  withSandbox(async (_t, { fakeHome, projectRoot }) => {
    const { STORE_DIR } = require("../lib/constants");
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    process.chdir(projectRoot);
    store.ensureDirs();
    const config = store.readConfig();
    config.projectRoot = projectRoot;
    config.agent = "claude-code";
    store.writeConfig(config);

    seedSkill(STORE_DIR, "alpha");

    // Simulate state left behind by a pre-PR-A version of skillbook:
    // a regular file `<skill>.md` sitting in the agent skills dir.
    const skillsDir = path.join(projectRoot, ".claude", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    const legacyFile = path.join(skillsDir, "alpha.md");
    fs.writeFileSync(legacyFile, "legacy garbage");

    store.saveSet("s", { description: "", skills: ["alpha"], agents: ["claude-code"] });
    commands.equip(["s"]);

    assert.equal(
      fs.existsSync(legacyFile),
      false,
      "legacy <skill>.md regular file must be cleaned up",
    );
    const linkPath = path.join(skillsDir, "alpha");
    assert.ok(fs.existsSync(linkPath), "new directory symlink must exist");
    assert.ok(
      fs.lstatSync(linkPath).isSymbolicLink(),
      "new entry must be a symlink",
    );
    assert.ok(
      fs.existsSync(path.join(linkPath, "SKILL.md")),
      "SKILL.md must resolve through the symlink",
    );
    assert.ok(
      fakeHome && fakeHome.length > 0,
      "sandbox fakeHome is set (sanity)",
    );
  }),
);

test(
  "equip should create `<agent-skills-dir>/<skill>/SKILL.md` layout (not a flat file)",
  withSandbox(async (_t, { projectRoot }) => {
    const { STORE_DIR } = require("../lib/constants");
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    process.chdir(projectRoot);
    store.ensureDirs();
    const config = store.readConfig();
    config.projectRoot = projectRoot;
    config.agent = "claude-code";
    store.writeConfig(config);

    seedSkill(STORE_DIR, "code-review");
    store.saveSet("s", {
      description: "",
      skills: ["code-review"],
      agents: ["claude-code"],
    });
    commands.equip(["s"]);

    const skillsDir = path.join(projectRoot, ".claude", "skills");
    const flatPath = path.join(skillsDir, "code-review.md");
    const dirPath = path.join(skillsDir, "code-review");

    assert.equal(
      fs.existsSync(flatPath),
      false,
      "flat <skill>.md symlink must NOT be used (Claude Code ignores it)",
    );
    assert.ok(fs.existsSync(dirPath), "<skill> entry must exist");
    assert.ok(
      fs.lstatSync(dirPath).isSymbolicLink(),
      "<skill> entry must be a symlink (so updates in store propagate)",
    );
    const skillMd = path.join(dirPath, "SKILL.md");
    assert.ok(
      fs.existsSync(skillMd),
      "SKILL.md must resolve through the symlink — this is what agents read",
    );
  }),
);

test(
  "unequip should remove legacy `<skill>.md` regular files for skills in the active set",
  withSandbox(async (_t, { projectRoot }) => {
    const { STORE_DIR } = require("../lib/constants");
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    process.chdir(projectRoot);
    store.ensureDirs();
    const config = store.readConfig();
    config.projectRoot = projectRoot;
    config.agent = "claude-code";
    store.writeConfig(config);

    seedSkill(STORE_DIR, "alpha");
    store.saveSet("s", { description: "", skills: ["alpha"], agents: ["claude-code"] });
    commands.equip(["s"]);

    const skillsDir = path.join(projectRoot, ".claude", "skills");
    const legacyMatch = path.join(skillsDir, "alpha.md");
    const legacyOther = path.join(skillsDir, "user-notes.md");
    fs.writeFileSync(legacyMatch, "leftover from old skillbook");
    fs.writeFileSync(legacyOther, "user's own notes");

    commands.unequip();

    assert.equal(
      fs.existsSync(legacyMatch),
      false,
      "legacy `<skill>.md` matching the active set must be cleaned up",
    );
    assert.ok(
      fs.existsSync(legacyOther),
      "regular .md file NOT in the active set must be preserved",
    );
  }),
);

test(
  "unequip should remove skillbook-managed symlinks but keep user-created files",
  withSandbox(async (_t, { projectRoot }) => {
    const { STORE_DIR } = require("../lib/constants");
    const store = require("../lib/store");
    const commands = require("../lib/commands");

    process.chdir(projectRoot);
    store.ensureDirs();
    const config = store.readConfig();
    config.projectRoot = projectRoot;
    config.agent = "claude-code";
    store.writeConfig(config);

    seedSkill(STORE_DIR, "alpha");
    store.saveSet("s", { description: "", skills: ["alpha"], agents: ["claude-code"] });
    commands.equip(["s"]);

    // User-created regular dir that skillbook should NOT touch.
    const userDir = path.join(projectRoot, ".claude", "skills", "user-owned");
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, "SKILL.md"), "# mine\n");

    commands.unequip();

    const alphaLink = path.join(projectRoot, ".claude", "skills", "alpha");
    assert.equal(fs.existsSync(alphaLink), false, "skillbook symlink removed");
    assert.ok(fs.existsSync(userDir), "user's own skill dir preserved");
    assert.ok(
      fs.existsSync(path.join(userDir, "SKILL.md")),
      "user's SKILL.md preserved",
    );
  }),
);
