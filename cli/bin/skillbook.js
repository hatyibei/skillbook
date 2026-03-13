#!/usr/bin/env node
const cmd = require("../lib/commands");
const ui = require("../lib/ui");
const [,, command, ...args] = process.argv;
const map = {
  init: cmd.init, add: cmd.add, import: cmd.importSkill, install: cmd.install,
  create: cmd.create, equip: cmd.equip, unequip: cmd.unequip, fork: cmd.fork,
  agent: cmd.agent, publish: cmd.publish, list: cmd.list, ls: cmd.list,
  status: cmd.status, st: cmd.status, help: cmd.help, "--help": cmd.help, "-h": cmd.help,
};
if (!command) { ui.banner(); console.log("  Run 'skillbook help' for usage.\n"); }
else if (map[command]) map[command](args);
else { ui.err(`Unknown command: ${command}`); console.log("  Run 'skillbook help'\n"); process.exit(1); }
