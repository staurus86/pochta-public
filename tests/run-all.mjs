// Runs every tests/*.test.js file and reports a full summary.
// Replaces the old `node a && node b && ...` chain, which short-circuited at the first
// file with a non-zero exit (email-analyzer.test.js) and so never ran most of the suite.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();

const failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) failed.push(f);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`${files.length - failed.length}/${files.length} test files passed`);
if (failed.length) {
  console.error(`FAILED FILES (${failed.length}):\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
