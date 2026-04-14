const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const https = require("https");
const http = require("http");
const { STORE_DIR, SETS_DIR, AGENT_SKILL_DIRS, C, API_BASE } = require("./constants");
const store = require("./store");
const ui = require("./ui");

// Reject names that could escape ~/.skillbook/ via path traversal or shell metachars.
// Returns true if validated, false (with ui.err) otherwise.
function checkName(name, label = "name") {
  if (!store.isValidName(name)) {
    ui.err(`Invalid ${label} ${JSON.stringify(name)} — ${store.NAME_HINT}`);
    return false;
  }
  return true;
}

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
  if (!checkName(name, "skill name")) return;
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
    if (!checkName(name, "skill name")) return;
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

  // Local path (file or directory)
  const absSource = path.resolve(source);
  if (!fs.existsSync(absSource)) return ui.err(`Path not found: ${absSource}`);
  const isFile = fs.statSync(absSource).isFile();
  const defaultName = isFile ? path.basename(absSource, path.extname(absSource)) : path.basename(absSource);
  const name = flags.name || defaultName;
  if (!checkName(name, "skill name")) return;
  const dest = path.join(STORE_DIR, name);
  if (fs.existsSync(dest)) return ui.warn(`"${name}" already exists.`);
  if (isFile) {
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(absSource, path.join(dest, "SKILL.md"));
  } else {
    store.copyDirSync(absSource, dest);
  }
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
        if (!store.isValidName(name)) { ui.warn(`Skipping invalid skill name "${name}" (${store.NAME_HINT}).`); continue; }
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
  if (!checkName(name, "set name")) return;
  const skills = flags.skills ? flags.skills.split(",").map(s => s.trim()) : [];
  for (const s of skills) { if (!checkName(s, "skill name")) return; }
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
  if (!checkName(name, "set name")) return;
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

  // Remove existing skillbook symlinks (not user's original files).
  // Claude Code / codex / cursor などのskills仕様は <skill-name>/SKILL.md (ディレクトリ型) なので、
  // 旧フラットファイル形式 (<skill-name>.md) の残骸も合わせて掃除する。
  if (fs.existsSync(targetDir)) {
    const skillNames = new Set((setData.skills || []));
    for (const item of fs.readdirSync(targetDir)) {
      const p = path.join(targetDir, item);
      const lst = fs.lstatSync(p);
      const isLink = lst.isSymbolicLink();
      const isInstructions = item.startsWith("_") && item.endsWith("_instructions.md");
      // Legacy layout from older skillbook: `<skill>.md` regular file in skills dir.
      const legacyName = item.endsWith(".md") ? item.slice(0, -3) : null;
      const isLegacyFile = lst.isFile() && legacyName && skillNames.has(legacyName);
      if (isLink) { fs.unlinkSync(p); continue; }
      if (isInstructions) { fs.unlinkSync(p); continue; }
      if (isLegacyFile) { fs.unlinkSync(p); continue; }
    }
  }

  // Link skill directories (contains SKILL.md) so agents recognize them as skills.
  let linked = 0;
  for (const sk of setData.skills || []) {
    const skillDir = path.join(STORE_DIR, sk);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) { ui.warn(`"${sk}" not in store (no SKILL.md), skipping.`); continue; }
    const lnk = path.join(targetDir, sk);
    if (!fs.existsSync(lnk)) { fs.symlinkSync(skillDir, lnk, "dir"); linked++; }
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
  if (!fs.existsSync(targetDir)) {
    config.activeSet = null;
    store.writeConfig(config);
    return ui.info("Nothing to unequip.");
  }

  // Mirror equip()'s legacy-file cleanup so the pair is symmetric: any
  // `<skill>.md` regular file matching a skill in the currently-active set
  // is skillbook's leftover from older versions and must be removed too.
  const activeSetData = config.activeSet ? store.getSet(config.activeSet) : null;
  const skillNames = new Set((activeSetData && activeSetData.skills) || []);

  let removed = 0;
  for (const item of fs.readdirSync(targetDir)) {
    const p = path.join(targetDir, item);
    const lst = fs.lstatSync(p);
    const isLink = lst.isSymbolicLink();
    const isInstructions = item.startsWith("_") && item.endsWith("_instructions.md");
    const legacyName = item.endsWith(".md") ? item.slice(0, -3) : null;
    const isLegacyFile = lst.isFile() && legacyName && skillNames.has(legacyName);
    if (isLink) { fs.unlinkSync(p); removed++; continue; }
    if (isInstructions) { fs.unlinkSync(p); removed++; continue; }
    if (isLegacyFile) { fs.unlinkSync(p); removed++; continue; }
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
  if (!checkName(source, "set name")) return;
  if (!checkName(newName, "set name")) return;

  const setData = store.getSet(source);
  if (!setData) return ui.err(`Set "${source}" not found.`);
  if (store.getSet(newName) && !flags.force) {
    return ui.warn(`Set "${newName}" already exists. Use --force to overwrite.`);
  }

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

  const oldAgent = config.agent;
  const activeSet = config.activeSet;

  // Clean up the OLD agent's skills dir before switching, so we don't leave
  // stale symlinks pointing into the store from the previously-active agent.
  // unequip() reads config from disk, so call it while config.agent is still oldAgent.
  if (activeSet && oldAgent && oldAgent !== newAgent) {
    unequip();
  }

  config.agent = newAgent;
  if (activeSet) config.activeSet = activeSet; // unequip cleared it; restore for re-equip below
  store.writeConfig(config);
  ui.ok(`Switched to ${newAgent}`);
  ui.info(`Skills dir: ${AGENT_SKILL_DIRS[newAgent]}`);

  if (activeSet) {
    ui.info(`Re-equipping "${activeSet}" for ${newAgent}...`);
    equip([activeSet]);
  }
}

// ===== PUBLISH (prepare for npm publish) =====
function publish(args) {
  const { flags, positional } = parseFlags(args);
  const setName = positional[0];
  if (!setName) return ui.err("Usage: skillbook publish <set-name>");
  if (!checkName(setName, "set name")) return;

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

// ===== API Helper =====
// Surface HTTP status and a body excerpt so users can tell 401/500/HTML errors
// apart from genuine JSON parse failures.
function bodyExcerpt(s) { return (s || "").slice(0, 120).replace(/\s+/g, " ").trim(); }
function settleResponse(res, data, resolve, reject) {
  const status = res.statusCode || 0;
  if (status < 200 || status >= 300) {
    return reject(new Error(`HTTP ${status} ${res.statusMessage || ""}: ${bodyExcerpt(data)}`.trim()));
  }
  try { resolve(JSON.parse(data)); }
  catch { reject(new Error(`Invalid JSON response (status ${status}, body: ${bodyExcerpt(data)})`)); }
}

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_BASE);
    const mod = url.protocol === "https:" ? https : http;
    mod.get(url.toString(), { headers: { "Accept": "application/json" } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => settleResponse(res, data, resolve, reject));
    }).on("error", reject);
  });
}

function apiPost(urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, API_BASE);
    const mod = url.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const req = mod.request(url.toString(), { method: "POST", headers }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => settleResponse(res, data, resolve, reject));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ===== SEARCH (from skillbook catalog) =====
async function search(args) {
  const query = args.join(" ");
  if (!query) return ui.err("Usage: skillbook search <keyword>");
  try {
    ui.info(`Searching skillbook catalog for "${query}"...`);
    const data = await apiGet(`/api/agent/search?q=${encodeURIComponent(query)}`);
    const skills = data.results || data.skills || [];
    if (!skills.length) { ui.warn("No results found."); return; }
    console.log(`\n  ${C.BOLD}Search Results (${skills.length})${C.RESET}\n`);
    for (const s of skills.slice(0, 15)) {
      const r = (s.rarity || "COMMON").toUpperCase();
      const rc = require("./constants").RARITY_COLORS[r] || C.DIM;
      const icon = s.icon || "⚔️";
      const installs = s.installs || 0;
      const rating = (s.avgRating || s.rating || 0).toFixed(1);
      console.log(`  ${icon} ${rc}[${r}]${C.RESET} ${C.BOLD}${s.name || s.id}${C.RESET} ${C.DIM}(${s.id})${C.RESET}`);
      console.log(`    ${s.description_ja || s.description || ""}`);
      console.log(`    ${C.CYAN}★${rating}${C.RESET} | ${installs} installs | ${(s.agents || []).join(", ")}`);
      console.log(`    ${C.DIM}→ skillbook get ${s.id}${C.RESET}\n`);
    }
  } catch (e) {
    ui.err(`Search failed: ${e.message}`);
  }
}

// ===== GET (download skill from catalog) =====
async function get(args) {
  const { flags, positional } = parseFlags(args);
  const id = positional[0];
  if (!id) return ui.err("Usage: skillbook get <skill-id> [--force]");
  if (!checkName(id, "skill id")) return;
  store.ensureDirs();

  const dest = path.join(STORE_DIR, id);
  if (fs.existsSync(dest)) {
    if (flags.force) {
      fs.rmSync(dest, { recursive: true });
    } else {
      ui.warn(`"${id}" already exists in store. Use --force to overwrite.`); return;
    }
  }

  try {
    ui.info(`Downloading "${id}" from skillbook catalog...`);
    const data = await apiGet(`/api/agent/install/${encodeURIComponent(id)}`);

    if (data.error) { ui.err(data.error); return; }
    if (!data.content && !data.metadata) { ui.err(`Skill "${id}" not found in catalog.`); return; }

    // Write SKILL.md
    fs.mkdirSync(dest, { recursive: true });
    const content = data.content || `---\nname: ${id}\n---\n\n# ${data.metadata?.name || id}\n`;
    fs.writeFileSync(path.join(dest, "SKILL.md"), content);

    const meta = data.metadata || {};
    const r = (meta.rarity || "COMMON").toUpperCase();
    const rc = require("./constants").RARITY_COLORS[r] || C.DIM;
    ui.ok(`Downloaded "${id}" ${rc}[${r}]${C.RESET}`);
    ui.info(`Stored: ~/.skillbook/store/${id}/SKILL.md`);
    ui.info(`Now equip it: skillbook equip <set-with-this-skill>`);

    // Track install
    apiPost(`/api/track/install`, { skillId: id, agent: "cli" }).catch(() => {});
  } catch (e) {
    ui.err(`Download failed: ${e.message}`);
  }
}

// Resolve a catalog search-result list to a single skill by exact id, then by
// exact name (case-insensitive, trimmed). Returns undefined to mean "skip" —
// callers must NOT fall back to results[0]; the search engine's best-effort
// top hit can return a different skill than what the set actually references.
function resolveExactSkill(results, skillName) {
  if (!Array.isArray(results) || !skillName) return undefined;
  const norm = String(skillName).toLowerCase().trim();
  return results.find(r => r && r.id === skillName)
    || results.find(r => r && typeof r.name === "string" && r.name.toLowerCase().trim() === norm);
}

// ===== GET-SET (download entire set from catalog) =====
async function getSet(args) {
  const id = args[0];
  if (!id) return ui.err("Usage: skillbook get-set <set-id>");
  if (!checkName(id, "set id")) return;
  store.ensureDirs();

  try {
    ui.info(`Fetching set "${id}" from catalog...`);
    const setsData = await apiGet(`/api/sets`);
    const sets = setsData.sets || [];
    const target = sets.find(s => s.id === id || s.name === id);
    if (!target) { ui.err(`Set "${id}" not found in catalog.`); return; }

    // Parse skill IDs from set
    const skillNames = (target.skills || []).map(sk => {
      if (typeof sk === "string") {
        // Remove emoji prefix: "👀 コードレビューアシスタント" → try to match by name
        return sk.replace(/^[^\w]+\s*/, "").trim();
      }
      return sk.name || sk.id || sk;
    });

    ui.info(`Set "${target.name}" contains ${skillNames.length} skills`);

    // Download each skill
    const downloadedSkills = [];
    for (const skillName of skillNames) {
      // Search for the skill by name in catalog
      const skillsData = await apiGet(`/api/agent/search?q=${encodeURIComponent(skillName)}`);
      const results = skillsData.results || skillsData.skills || [];
      const match = resolveExactSkill(results, skillName);

      if (match) {
        const skillId = match.id;
        if (!store.isValidName(skillId)) {
          ui.warn(`Catalog returned invalid skill id "${skillId}", skipping.`);
          continue;
        }
        const dest = path.join(STORE_DIR, skillId);
        if (!fs.existsSync(dest)) {
          const installData = await apiGet(`/api/agent/install/${encodeURIComponent(skillId)}`);
          if (installData.content) {
            fs.mkdirSync(dest, { recursive: true });
            fs.writeFileSync(path.join(dest, "SKILL.md"), installData.content);
            ui.ok(`Downloaded "${skillId}"`);
          } else {
            ui.warn(`No content for "${skillId}", creating placeholder`);
            fs.mkdirSync(dest, { recursive: true });
            fs.writeFileSync(path.join(dest, "SKILL.md"), `---\nname: ${skillId}\n---\n\n# ${match.name || skillId}\n`);
          }
        } else {
          ui.info(`"${skillId}" already in store`);
        }
        downloadedSkills.push(skillId);
      } else {
        ui.warn(`Could not uniquely resolve "${skillName}" — no exact id/name match in catalog.`);
      }
    }

    // Create local set
    const setName = target.id || target.name;
    if (!store.isValidName(setName)) {
      ui.err(`Catalog returned invalid set name "${setName}", aborting save.`);
      return;
    }
    store.saveSet(setName, {
      description: target.description || "",
      skills: downloadedSkills,
      custom_instructions: "",
      agents: target.agents || ["claude-code"],
      created: new Date().toISOString(),
    });

    ui.ok(`Set "${setName}" ready with ${downloadedSkills.length} skills`);
    ui.info(`Equip it: skillbook equip ${setName}`);
  } catch (e) {
    ui.err(`Failed: ${e.message}`);
  }
}

// ===== LOGIN (store API key) =====
function login(args) {
  const { flags } = parseFlags(args);
  const apiKey = flags["api-key"] || flags.key || args[0];
  if (!apiKey) {
    ui.err("Usage: skillbook login --api-key sk_xxxxx");
    ui.info("Get your API key at: https://skillbooks.dev (マイページ)");
    return;
  }
  const config = store.readConfig();
  config.apiKey = apiKey;
  store.writeConfig(config);
  ui.ok("API key saved to ~/.skillbook/config.json");
  ui.info("You can now publish skills: skillbook publish-remote <set-name>");
}

// ===== PUBLISH-REMOTE (publish to skillbook catalog using API key) =====
async function publishRemote(args) {
  const { flags, positional } = parseFlags(args);
  const setName = positional[0];
  if (!setName) return ui.err("Usage: skillbook publish-remote <set-name>");
  if (!checkName(setName, "set name")) return;

  const config = store.readConfig();
  if (!config.apiKey) {
    ui.err("Not logged in. Run: skillbook login --api-key sk_xxxxx");
    return;
  }

  const setData = store.getSet(setName);
  if (!setData) return ui.err(`Set "${setName}" not found.`);

  // Build skills payload
  const skills = [];
  for (const sk of setData.skills || []) {
    const skillFile = path.join(STORE_DIR, sk, "SKILL.md");
    if (!fs.existsSync(skillFile)) { ui.warn(`"${sk}" not in store, skipping.`); continue; }
    const content = fs.readFileSync(skillFile, "utf-8");
    const meta = store.readSkillMeta(sk);
    skills.push({
      id: sk,
      name: meta.name || sk,
      description: meta.description || "",
      description_ja: meta.description_ja || "",
      rarity: meta.rarity || "COMMON",
      agents: meta.agents || ["claude-code"],
      content,
    });
  }

  const payload = {
    setName,
    description: setData.description || "",
    skills,
    agents: setData.agents || ["claude-code"],
    custom_instructions: setData.custom_instructions || "",
  };

  try {
    ui.info(`Publishing "${setName}" (${skills.length} skills) to catalog...`);
    const result = await apiPost("/api/agent/publish", payload, config.apiKey);
    if (result.error) { ui.err(result.error); return; }
    ui.ok(`Published "${setName}" to skillbook catalog`);
    if (result.url) ui.info(`View: ${result.url}`);
    if (result.setId) ui.info(`Install: skillbook get-set ${result.setId}`);
  } catch (e) {
    ui.err(`Publish failed: ${e.message}`);
  }
}

// ===== BROWSE (discover curated skills) =====
async function browse(args) {
  const agent = args[0] || "claude-code";
  try {
    ui.info(`Fetching recommended skills for ${agent}...`);
    const data = await apiGet(`/api/agent/discover?agent=${encodeURIComponent(agent)}`);
    const skills = data.recommended_skills || [];
    const sets = data.recommended_sets || [];
    if (!skills.length && !sets.length) { ui.warn("No recommendations found."); return; }
    if (skills.length) {
      console.log(`\n  ${C.BOLD}📖 Recommended Skills for ${agent}${C.RESET}\n`);
      for (const s of skills) {
        const r = (s.rarity || "COMMON").toUpperCase();
        const rc = require("./constants").RARITY_COLORS[r] || C.DIM;
        console.log(`  ${s.icon || "⚔️"} ${rc}[${r}]${C.RESET} ${C.BOLD}${s.name || s.id}${C.RESET}`);
        console.log(`    ${s.description_ja || s.description || ""}`);
        console.log(`    ${C.DIM}→ skillbook get ${s.id}${C.RESET}\n`);
      }
    }
    if (sets.length) {
      console.log(`  ${C.BOLD}📦 Recommended Sets${C.RESET}\n`);
      for (const s of sets) {
        console.log(`  📦 ${C.BOLD}${s.name || s.id}${C.RESET} (${s.skill_count} skills)`);
        console.log(`    ${s.description || ""}`);
        console.log(`    ${C.DIM}→ skillbook get-set ${s.id}${C.RESET}\n`);
      }
    }
  } catch (e) {
    ui.err(`Browse failed: ${e.message}`);
  }
}

// Updated help
function helpFull() {
  ui.banner();
  console.log(`  ${C.BOLD}Core Commands:${C.RESET}
    init [agent]                          Initialize for an agent
    add <name>                            Create a blank skill in store
    import <path|git-url> [--name alias]  Import skill from local dir or git
    install <npm-package>                 Install skill(s) from npm
    create <set> --skills a,b --desc "…"  Create a named skill set
    equip <set>                           Activate a skill set
    unequip                               Deactivate current set

  ${C.BOLD}${C.YELLOW}Catalog Commands:${C.RESET}
    search <keyword>                      Search the skillbook catalog
    browse [agent]                        Discover recommended skills
    get <skill-id>                        Download a skill from catalog
    get-set <set-id>                      Download an entire set + skills

  ${C.BOLD}Management:${C.RESET}
    list [skills|sets|all]                List skills and/or sets
    status                                Show configuration
    agent [name]                          Switch agent (or show current)
    fork <set> --name <new>               Fork a skill set

  ${C.BOLD}Publishing:${C.RESET}
    login --api-key sk_xxxxx              Store your API key
    publish <set> [--scope org]           Prepare set for npm publish
    publish-remote <set>                  Publish set to skillbook catalog

  ${C.BOLD}Agents:${C.RESET} ${Object.keys(AGENT_SKILL_DIRS).join(", ")}

  ${C.BOLD}Examples:${C.RESET}
    $ skillbook search コードレビュー
    $ skillbook get code-review
    $ skillbook get-set dev-review-set
    $ skillbook equip dev-review-set
    $ skillbook browse cursor
    $ skillbook login --api-key sk_193c28...
    $ skillbook publish-remote my-set
`);
}

module.exports = { init, add, importSkill, install, create, equip, unequip, fork, agent, publish, publishRemote, list, status, help: helpFull, search, get, getSet, login, browse, _internal: { settleResponse, resolveExactSkill } };
