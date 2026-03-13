const { C, RARITY_COLORS } = require("./constants");

const banner = () => console.log(`
${C.YELLOW}${C.BOLD}  ╔══════════════════════════════════╗
  ║  📖 スキルの書  The SkillBook    ║
  ║     v0.1.0  — MVP Preview        ║
  ╚══════════════════════════════════╝${C.RESET}
`);

const ok = (m) => console.log(`${C.GREEN}✓${C.RESET} ${m}`);
const info = (m) => console.log(`${C.BLUE}ℹ${C.RESET} ${m}`);
const warn = (m) => console.log(`${C.YELLOW}⚠${C.RESET} ${m}`);
const err = (m) => console.log(`${C.RED}✗${C.RESET} ${m}`);

function skillCard(name, meta = {}) {
  const r = meta.rarity || "COMMON";
  const rc = RARITY_COLORS[r] || C.DIM;
  const agents = Array.isArray(meta.agents) ? meta.agents.join(", ") : (meta.agents || "all");
  const desc = meta.description_ja || meta.description || "";
  console.log(`  ${rc}[${r}]${C.RESET} ${C.BOLD}${name}${C.RESET}`);
  if (desc) console.log(`    ${C.DIM}${desc}${C.RESET}`);
  console.log(`    ${C.CYAN}agents:${C.RESET} ${agents}\n`);
}

function setCard(set, active = false) {
  const badge = active ? ` ${C.GREEN}[EQUIPPED]${C.RESET}` : "";
  console.log(`  ⚔️  ${C.BOLD}${set.name}${C.RESET}${badge}`);
  if (set.description) console.log(`    ${C.DIM}${set.description}${C.RESET}`);
  if (set.skills?.length) console.log(`    ${C.CYAN}skills:${C.RESET} ${set.skills.join(", ")}`);
  console.log();
}

function table(headers, rows) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] || "").length)) + 2);
  const line = w.map(n => "─".repeat(n)).join("┼");
  console.log(`  ${C.DIM}${line}${C.RESET}`);
  console.log(`  ${headers.map((h, i) => `${C.BOLD}${h.padEnd(w[i])}${C.RESET}`).join("│")}`);
  console.log(`  ${C.DIM}${line}${C.RESET}`);
  rows.forEach(r => console.log(`  ${r.map((c, i) => (c || "").padEnd(w[i])).join("│")}`));
  console.log(`  ${C.DIM}${line}${C.RESET}`);
}

module.exports = { banner, ok, info, warn, err, skillCard, setCard, table, C };
