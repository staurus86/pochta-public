import assert from "node:assert/strict";
import { analyzeEmail } from "../src/services/email-analyzer.js";

const project = { mailbox: "x@example.com", brands: [], managerPool: { brandOwners: [] }, knownCompanies: [] };

function runTest(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (e) { console.error(`FAIL ${name}`); console.error(e); process.exitCode = 1; }
}

const strip = (a) => String(a).replace(/[\s\-./]+/g, "").toLowerCase();

// COLLAPSE: separator-only variant of the same article must not inflate positions.
// "PS 6-200-15" is a separator-stripped prefix of "PS6-200-15-1" → one item, qty not doubled.
runTest("variant-dedup: separator-variant article collapses to one position", () => {
  const a = analyzeEmail(project, {
    fromEmail: "b@kspa.pro",
    subject: "Заявка",
    body: "Добрый день, пришлите КП на\nМембрана PS 6-200-15-1 PTFE\n\nPS6-200-15-1\n\n10\n\nшт",
  });
  const arts = (a.lead.articles || []).map(strip);
  // the truncated "ps620015" prefix must not coexist with the full "ps6200151"
  const hasFull = arts.includes("ps6200151");
  const hasTrunc = arts.some((k) => k !== "ps6200151" && "ps6200151".startsWith(k));
  assert.ok(hasFull, `expected full article present, got ${JSON.stringify(a.lead.articles)}`);
  assert.ok(!hasTrunc, `truncated variant should be dropped, got ${JSON.stringify(a.lead.articles)}`);
  assert.equal(a.lead.totalPositions, 1, `expected 1 position, got ${a.lead.totalPositions}`);
});

// PRESERVE: two genuinely distinct articles must stay two positions (guard against over-merge,
// which would reproduce the opposite manager complaint "5 позиций, указал одну").
runTest("variant-dedup: distinct articles stay separate positions", () => {
  const a = analyzeEmail(project, {
    fromEmail: "b@kspa.pro",
    subject: "Заявка",
    body: "Прошу КП:\n1) Автомат S201-C16 — 10 шт\n2) Автомат S203-C25 — 5 шт",
  });
  const arts = (a.lead.articles || []).map(strip);
  assert.ok(arts.includes("s201c16"), `S201-C16 missing: ${JSON.stringify(a.lead.articles)}`);
  assert.ok(arts.includes("s203c25"), `S203-C25 missing: ${JSON.stringify(a.lead.articles)}`);
  assert.equal(a.lead.totalPositions, 2, `expected 2 positions, got ${a.lead.totalPositions}`);
});
