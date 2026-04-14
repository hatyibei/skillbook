const test = require("node:test");
const assert = require("node:assert");

const { _internal } = require("../lib/commands");
const { resolveExactSkill } = _internal;

test("resolveExactSkill prefers exact id match", () => {
  const results = [
    { id: "code-quality", name: "Code Quality" },
    { id: "code-review", name: "Code Review" },
  ];
  const r = resolveExactSkill(results, "code-review");
  assert.equal(r.id, "code-review");
});

test("resolveExactSkill falls back to exact name (case/space insensitive)", () => {
  const results = [
    { id: "x", name: "Some Other" },
    { id: "cr", name: "  Code Review  " },
  ];
  const r = resolveExactSkill(results, "code review");
  assert.equal(r.id, "cr");
});

test("resolveExactSkill returns undefined when no exact match (no fuzzy fallback)", () => {
  const results = [
    { id: "code-review", name: "Code Review" },
    { id: "code-quality", name: "Code Quality" },
  ];
  const r = resolveExactSkill(results, "coding");
  assert.equal(r, undefined, "must not pick results[0] as a guess");
});

test("resolveExactSkill is safe with empty / non-array inputs", () => {
  assert.equal(resolveExactSkill([], "x"), undefined);
  assert.equal(resolveExactSkill(null, "x"), undefined);
  assert.equal(resolveExactSkill([{ id: "x" }], ""), undefined);
});

test("resolveExactSkill skips entries with no id and no name", () => {
  const results = [{}, { id: null }, { id: "ok", name: "OK" }];
  assert.equal(resolveExactSkill(results, "ok").id, "ok");
});
