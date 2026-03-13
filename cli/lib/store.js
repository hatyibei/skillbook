const fs = require("fs");
const path = require("path");
const { SKILLBOOK_HOME, STORE_DIR, SETS_DIR, CONFIG_FILE } = require("./constants");

function ensureDirs() {
  for (const dir of [SKILLBOOK_HOME, STORE_DIR, SETS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    writeConfig({ activeSet: null, agent: "claude-code", projectRoot: process.cwd() });
  }
}

function readConfig() {
  ensureDirs();
  return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
}

function writeConfig(config) {
  fs.mkdirSync(SKILLBOOK_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function listSkills() {
  ensureDirs();
  if (!fs.existsSync(STORE_DIR)) return [];
  return fs.readdirSync(STORE_DIR).filter(f =>
    fs.existsSync(path.join(STORE_DIR, f, "SKILL.md"))
  );
}

function listSets() {
  ensureDirs();
  if (!fs.existsSync(SETS_DIR)) return [];
  return fs.readdirSync(SETS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => ({ name: f.replace(".json", ""), ...JSON.parse(fs.readFileSync(path.join(SETS_DIR, f), "utf-8")) }));
}

function getSet(name) {
  const p = path.join(SETS_DIR, `${name}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
}

function saveSet(name, data) {
  ensureDirs();
  fs.writeFileSync(path.join(SETS_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

function readSkillMeta(skillName) {
  const p = path.join(STORE_DIR, skillName, "SKILL.md");
  if (!fs.existsSync(p)) return {};
  const content = fs.readFileSync(p, "utf-8");
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return {};
  const meta = {};
  for (const line of fm[1].split("\n")) {
    const m = line.match(/^(\w[\w_]*)\s*:\s*(.+)$/);
    if (m) {
      let val = m[2].trim();
      if (val.startsWith("[") && val.endsWith("]")) val = val.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
      else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      meta[m[1]] = val;
    }
  }
  return meta;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

module.exports = { ensureDirs, readConfig, writeConfig, listSkills, listSets, getSet, saveSet, readSkillMeta, copyDirSync };
