const path = require("path");
const os = require("os");

const SKILLBOOK_HOME = path.join(os.homedir(), ".skillbook");
const STORE_DIR = path.join(SKILLBOOK_HOME, "store");
const SETS_DIR = path.join(SKILLBOOK_HOME, "sets");
const CONFIG_FILE = path.join(SKILLBOOK_HOME, "config.json");

const AGENT_SKILL_DIRS = {
  "claude-code":  ".claude/skills",
  "codex":        ".codex/skills",
  "cursor":       ".cursor/skills",
  "copilot":      ".github/copilot/skills",
  "gemini":       ".gemini/skills",
  "goose":        ".goose/skills",
  "kiro":         ".kiro/skills",
  "roo":          ".roo/skills",
  "windsurf":     ".windsurf/skills",
};

// ANSI colors
const C = {
  RESET: "\x1b[0m", BOLD: "\x1b[1m", DIM: "\x1b[2m",
  RED: "\x1b[31m", GREEN: "\x1b[32m", YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m", MAGENTA: "\x1b[35m", CYAN: "\x1b[36m", WHITE: "\x1b[37m",
};

const RARITY_COLORS = {
  LEGENDARY: C.YELLOW, EPIC: C.MAGENTA, RARE: C.BLUE, COMMON: C.DIM,
};

const API_BASE = "https://skillbook-api-140498091344.asia-northeast1.run.app";

module.exports = { SKILLBOOK_HOME, STORE_DIR, SETS_DIR, CONFIG_FILE, AGENT_SKILL_DIRS, C, RARITY_COLORS, API_BASE };
