#!/usr/bin/env node
// Fails when a spec or support file under `cypress/` names a stack port literally
// (`localhost:<port>`), instead of reading it from `cypress.config.ts` (#502).
//
// Why a guard and not a convention: a literal port silently pins a spec to the shared stack. Two
// stacks on one machine (parallel agents, a worktree next to a running dev stack) then disagree
// about where the app lives, and `cy.clearEmails()` against a hardcoded Mailpit once emptied the
// inbox another run was reading. The replacements are `Cypress.config("baseUrl")`,
// `Cypress.env("apiUrl")`, `Cypress.env("mailpitUrl")` and `Cypress.env("mailpitSmtpPort")`.
//
// Deliberately NOT matched: `127.0.0.1:1`, which several specs use as a guaranteed-unreachable
// endpoint for a transport that must never actually connect. That is not a stack port.
//
// Run from `e2e/`: `npm run check:ports`. CI runs it in the `e2e-typecheck` job.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const e2eRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["cypress/e2e", "cypress/support"].map((dir) => join(e2eRoot, dir));
const LITERAL_PORT = /localhost:\d+/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name)) yield path;
  }
}

const offences = [];
let scanned = 0;
for (const root of roots) {
  for (const file of walk(root)) {
    scanned++;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const match of line.matchAll(LITERAL_PORT)) {
          offences.push(`${relative(e2eRoot, file)}:${index + 1}: ${match[0]}`);
        }
      });
  }
}

if (offences.length > 0) {
  console.error(`Literal localhost:<port> found in ${offences.length} place(s):`);
  for (const offence of offences) console.error(`  ${offence}`);
  console.error(
    'Read the stack from cypress.config.ts instead: Cypress.config("baseUrl"), Cypress.env("apiUrl"),',
  );
  console.error('Cypress.env("mailpitUrl") or Cypress.env("mailpitSmtpPort").');
  process.exit(1);
}
console.log(`No literal localhost:<port> in ${scanned} file(s) under cypress/e2e and cypress/support.`);
