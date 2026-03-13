const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { STORE_DIR, SETS_DIR, AGENT_SKILL_DIRS, C } = require("./constants");
const store = require("./store");
const ui = require("./ui");

// ===== parseFlags: --key value pairs from args =====
function parseFlags(args) {
  const flags = {}; const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[++i];
    } else { positional.push(args[i]); }
  }
  return { flags, positional };
}

// ===== INIT =====
function init(args) {
  const agent = args[0] || "claude-code";
  const projectRoot = process.cwd();
  store.ensureDirs();
  const config = store.readConfig();
  config.agent = AGENT_SKILL_DIRS[agent] ? agent : "claude-code";
  config.projectRoot = projectRoot;
  store.writeConfig(config);

  const dir = path.join(projectRoot, AGENT_SKILL_DIRS[config.agent]);
  fs.mkdirSync(dir, { recursive: true });
  ui.ok(`Initialized skillbook for ${config.agent}`);
  ui.info(`Skills dir: ${dir}`);
  ui.info(`Store: ~/.skillbook/store/  |  Sets: ~/.skillbook/sets/`);
}

// ===== ADD =====
function add(args) {
  const name = args[0];
  if (!name) return ui.err("Usage: skillbook add <skill-name>");
  store.ensureDirs();
  const dir = path.join(STORE_DIR, name);
  const file = path.join(dir, "SKILL.md");
  if (fs.existsSync(file)) return ui.warn(`"${name}" already exists.`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `---
name: ${name}
description: ""
description_ja: ""
rarity: COMMON
agents: [claude-code, codex, cursor]
---

# ${name}

## Instructions

(Write your skill instructions here)
`);
  ui.ok(`Added "${name}" to store`);
  ui.info(`Edit: ~/.skillbook/store/${name}/SKILL.md`);
}

// ===== IMPORT (from local directory or git repo) =====
function importSkill(args) {
  const { flags, positional } = parseFlags(args);
  const source = positional[0];
  if (!source) return ui.err("Usage: skillbook import <path|git-url> [--name alias]");

  store.ensureDirs();

  // Git URL
  if (source.startsWith("http") || source.startsWith("git@")) {
    const name = flags.name || path.basename(source, ".git");
    const dest = path.join(STORE_DIR, name);
    if (fs.existsSync(dest)) return ui.warn(`"${name}" already exists.`);
    try {
      ui.info(`Cloning ${source}...`);
      execSync(`git clone --depth 1 "${source}" "${dest}"`, { stdio: "pipe" });
      // Remove .git to save space
      const gitDir = path.join(dest, ".git");
      if (fs.existsSync(gitDir)) fs.rmSync(gitDir, { recursive: true });
      ui.ok(`Imported "${name}" from git`);
    } catch (e) {
      ui.err(`Failed to clone: ${e.message}`);
    }
    return;
  }

  // Local directory
  const absSource = path.resolve(source);
  if (!fs.existsSync(absSource)) return ui.err(`Path not found: ${absSource}`);
  const name = flags.name || path.basename(absSource);
  const dest = path.join(STORE_DIR, name);
  if (fs.existsSync(dest)) return ui.warn(`"${name}" already exists.`);
  store.copyDirSync(absSource, dest);
  ui.ok(`Imported "${name}" from ${absSource}`);
}

// ===== INSTALL (from npm) =====
function install(args) {
  const pkg = args[0];
  if (!pkg) return ui.err("Usage: skillbook install <npm-package-name>");
  store.ensureDirs();
  const tmpDir = path.join(STORE_DIR, ".tmp-install");
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    ui.info(`Installing ${pkg} from npm...`);
    execSync(`npm pack "${pkg}" --pack-destination "${tmpDir}"`, { stdio: "pipe", cwd: tmpDir });
    const tgz = fs.readdirSync(tmpDir).find(f => f.endsWith(".tgz"));
    if (!tgz) throw new Error("No package downloaded");
    execSync(`tar xzf "${tgz}"`, { cwd: tmpDir, stdio: "pipe" });

    // Find SKILL.md in extracted package
    const pkgDir = path.join(tmpDir, "package");
    const skillDirs = findSkillDirs(pkgDir);

    if (skillDirs.length === 0) {
      ui.warn(`No SKILL.md found in "${pkg}". Not a skillbook package.`);
    } else {
      for (const sd of skillDirs) {
        const name = path.basename(sd);
        const dest = path.join(STORE_DIR, name);
        if (!fs.existsSync(dest)) {
          store.copyDirSync(sd, dest);
          ui.ok(`Installed skill "${name}"`);
        } else {
          ui.warn(`"${name}" already exists, skipping.`);
        }
      }
    }
  } catch (e) {
    ui.err(`Install failed: ${e.message}`);
  } finally {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  }
}

function findSkillDirs(dir) {
  const results = [];
  if (fs.existsSync(path.join(dir, "SKILL.md"))) results.push(dir);
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory() && !item.startsWith(".")) {
      results.push(...findSkillDirs(full));
    }
  }
  return results;
}

// ===== CREATE (Skill Set) =====
function create(args) {
  const { flags, positional } = parseFlags(args);
  const name = positional[0];
  if (!name) return ui.err("Usage: skillbook create <set-name> --skills a,b --desc \"...\"");
  const skills = flags.skills ? flags.skills.split(",").map(s => s.trim()) : [];
  const desc = flags.desc || "";

  store.saveSet(name, {
    description: desc,
    skills,
    custom_instructions: "",
    agents: ["claude-code"],
    created: new Date().toISOString(),
  });
  ui.ok(`Created skill set "${name}"`);
  if (skills.length) ui.info(`Skills: ${skills.join(", ")}`);
  ui.info(`Edit: ~/.skillbook/sets/${name}.json`);
}

// ===== EQUIP =====
function equip(args) {
  const name = args[0];
  if (!name) return ui.err("Usage: skillbook equip <set-name>");
  const config = store.readConfig();
  const setData = store.getSet(name);
  if (!setData) {
    ui.err(`Set "${name}" not found.`);
    store.listSets().forEach(s => console.log(`  - ${s.name}`));
    return;
  }

  const agent = config.agent || "claude-code";
  const targetDir = path.join(config.projectRoot || process.cwd(), AGENT_SKILL_DIRS[agent]);
  fs.mkdirSync(targetDir, { recursive: true });

  // Remove existing symlinks
  if (fs.existsSync(targetDir)) {
    for (const item of fs.readdirSync(targetDir)) {
      const p = path.join(targetDir, item);
      if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
      if (item.startsWith("_") && item.endsWith("_instructions.md")) fs.unlinkSync(p);
    }
  }

  // Link skills
  let linked = 0;
  for (const sk of setData.skills || []) {
    const src = path.join(STORE_DIR, sk);
    if (!fs.existsSync(src)) { ui.warn(`"${sk}" not in store, skipping.`); continue; }
    const lnk = path.join(targetDir, sk);
    if (!fs.existsSync(lnk)) { fs.symlinkSync(src, lnk, "dir"); linked++; }
  }

  if (setData.custom_instructions) {
    fs.writeFileSync(path.join(targetDir, `_${name}_instructions.md`), setData.custom_instructions);
  }

  config.activeSet = name;
  store.writeConfig(config);
  ui.ok(`Equipped "${name}" (${linked} skills)`);
  ui.info(`Agent: ${agent} | Target: ${targetDir}`);
}

// ===== UNEQUIP =====
function unequip() {
  const config = store.readConfig();
  const agent = config.agent || "claude-code";
  const targetDir = path.join(config.projectRoot || process.cwd(), AGENT_SKILL_DIRS[agent]);
  if (!fs.existsSync(targetDir)) return ui.info("Nothing to unequip.");

  let removed = 0;
  for (const item of fs.readdirSync(targetDir)) {
    const p = path.join(targetDir, item);
    if (fs.lstatSync(p).isSymbolicLink()) { fs.unlinkSync(p); removed++; }
    if (item.startsWith("_") && item.endsWith("_instructions.md")) fs.unlinkSync(p);
  }
  config.activeSet = null;
  store.writeConfig(config);
  ui.ok(`Unequipped (${removed} links removed)`);
}

// ===== FORK =====
function fork(args) {
  const { flags, positional } = parseFlags(args);
  const source = positional[0];
  const newName = flags.name || (source ? `${source}-fork` : null);
  if (!source) return ui.err("Usage: skillbook fork <set-name> --name <new-name>");

  const setData = store.getSet(source);
  if (!setData) return ui.err(`Set "${source}" not found.`);

  const forked = { ...setData, forkedFrom: source, created: new Date().toISOString() };
  store.saveSet(newName, forked);
  ui.ok(`Forked "${source}" → "${newName}"`);
  ui.info(`Edit: ~/.skillbook/sets/${newName}.json`);
}

// ===== AGENT =====
function agent(args) {
  const config = store.readConfig();
  const newAgent = args[0];

  if (!newAgent) {
    console.log(`\n  Current agent: ${C.BOLD}${config.agent}${C.RESET}\n`);
    console.log("  Available agents:");
    for (const a of Object.keys(AGENT_SKILL_DIRS)) {
      const mark = a === config.agent ? `${C.GREEN}● ${C.RESET}` : "  ";
      console.log(`    ${mark}${a}`);
    }
    console.log();
    return;
  }

  if (!AGENT_SKILL_DIRS[newAgent]) return ui.err(`Unknown agent: ${newAgent}`);
  config.agent = newAgent;
  store.writeConfig(config);
  ui.ok(`Switched to ${newAgent}`);
  ui.info(`Skills dir: ${AGENT_SKILL_DIRS[newAgent]}`);

  // Re-equip if set is active
  if (config.activeSet) {
    ui.info(`Re-equipping "${config.activeSet}" for ${newAgent}...`);
    equip([config.activeSet]);
  }
}

// ===== PUBLISH (prepare for npm publish) =====
function publish(args) {
  const { flags, positional } = parseFlags(args);
  const setName = positional[0];
  if (!setName) return ui.err("Usage: skillbook publish <set-name>");

  const setData = store.getSet(setName);
  if (!setData) return ui.err(`Set "${setName}" not found.`);

  const outDir = path.join(process.cwd(), `skillbook-${setName}`);
  fs.mkdirSync(outDir, { recursive: true });

  // Copy skills into package
  for (const sk of setData.skills || []) {
    const src = path.join(STORE_DIR, sk);
    if (fs.existsSync(src)) {
      store.copyDirSync(src, path.join(outDir, sk));
    }
  }

  // Write package.json
  const scope = flags.scope || "";
  const pkgName = scope ? `@${scope}/${setName}` : setName;
  const pkg = {
    name: pkgName,
    version: "1.0.0",
    description: setData.description || `SkillBook set: ${setName}`,
    keywords: ["skillbook", "ai-skills", "agent-skills", ...(setData.skills || [])],
    skillbook: {
      type: "skillset",
      skills: setData.skills || [],
      agents: setData.agents || ["claude-code"],
      custom_instructions: setData.custom_instructions || "",
    },
    license: "MIT",
  };
  fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify(pkg, null, 2));

  // Write README
  const readme = `# ${pkgName}\n\n${setData.description || ""}\n\n## Skills\n\n${(setData.skills || []).map(s => `- ${s}`).join("\n")}\n\n## Install\n\n\`\`\`bash\nnpx skillbook install ${pkgName}\nnpx skillbook equip ${setName}\n\`\`\`\n`;
  fs.writeFileSync(path.join(outDir, "README.md"), readme);

  // Write skillset.yaml
  const yaml = `name: ${pkgName}\nversion: 1.0.0\ndescription: ${setData.description || ""}\nskills:\n${(setData.skills || []).map(s => `  - ${s}`).join("\n")}\nagents: [${(setData.agents || ["claude-code"]).join(", ")}]\n`;
  fs.writeFileSync(path.join(outDir, "skillset.yaml"), yaml);

  ui.ok(`Package prepared: ${outDir}/`);
  ui.info(`To publish: cd ${outDir} && npm publish`);
}

// ===== LIST =====
function list(args) {
  const type = args[0] || "all";
  if (type === "skills" || type === "all") {
    const skills = store.listSkills();
    console.log(`\n  📦 ${C.BOLD}Skills in Store (${skills.length})${C.RESET}\n`);
    if (!skills.length) ui.info("No skills yet. Use 'skillbook add <name>' to add one.");
    skills.forEach(s => ui.skillCard(s, store.readSkillMeta(s)));
  }
  if (type === "sets" || type === "all") {
    const sets = store.listSets();
    const config = store.readConfig();
    console.log(`  ⚔️  ${C.BOLD}Skill Sets (${sets.length})${C.RESET}\n`);
    if (!sets.length) ui.info("No sets yet. Use 'skillbook create <name> --skills a,b' to create one.");
    sets.forEach(s => ui.setCard(s, config.activeSet === s.name));
  }
}

// ===== STATUS =====
function status() {
  const config = store.readConfig();
  console.log(`\n  📊 ${C.BOLD}SkillBook Status${C.RESET}\n`);
  ui.table(["Key", "Value"], [
    ["Agent", config.agent || "claude-code"],
    ["Project", config.projectRoot || process.cwd()],
    ["Active Set", config.activeSet || "(none)"],
    ["Skills", String(store.listSkills().length)],
    ["Sets", String(store.listSets().length)],
  ]);
  if (config.activeSet) {
    const set = store.getSet(config.activeSet);
    if (set) {
      console.log(`\n  Equipped: ${config.activeSet}`);
      (set.skills || []).forEach(s => {
        const exists = fs.existsSync(path.join(STORE_DIR, s));
        console.log(`    ${exists ? "✓" : "✗ (missing)"} ${s}`);
      });
    }
  }
  console.log();
}

// ===== HELP =====
function help() {
  ui.banner();
  console.log(`  ${C.BOLD}Core Commands:${C.RESET}
    init [agent]                          Initialize for an agent
    add <name>                            Create a blank skill in store
    import <path|git-url> [--name alias]  Import skill from local dir or git
    install <npm-package>                 Install skill(s) from npm
    create <set> --skills a,b --desc "…"  Create a named skill set
    equip <set>                           Activate a skill set
    unequip                               Deactivate current set

  ${C.BOLD}Management:${C.RESET}
    list [skills|sets|all]                List skills and/or sets
    status                                Show configuration
    agent [name]                          Switch agent (or show current)
    fork <set> --name <new>               Fork a skill set

  ${C.BOLD}Publishing:${C.RESET}
    publish <set> [--scope org]           Prepare set for npm publish

  ${C.BOLD}Agents:${C.RESET} ${Object.keys(AGENT_SKILL_DIRS).join(", ")}

  ${C.BOLD}Examples:${C.RESET}
    $ skillbook init claude-code
    $ skillbook add code-review
    $ skillbook import ./my-skills/data-viz --name data-viz
    $ skillbook install @hathibei/sales-kit
    $ skillbook create dev-set --skills code-review,data-viz --desc "開発セット"
    $ skillbook equip dev-set
    $ skillbook agent codex
    $ skillbook fork dev-set --name my-dev-set
    $ skillbook publish dev-set --scope hathibei
`);
}

module.exports = { init, add, importSkill, install, create, equip, unequip, fork, agent, publish, list, status, help };
