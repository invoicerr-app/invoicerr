#!/usr/bin/env node
// Writes REPORT.md for a run directory, or compares two of them.
//
//   npm run loadtest:report -- results/<run>
//   npm run loadtest:compare -- results/<before> results/<after>
import { writeReport, compare } from './lib/report.js';

const [a, b, c] = process.argv.slice(2);
if (a === 'compare') {
  if (!b || !c) throw new Error('usage: report.js compare <before-dir> <after-dir>');
  console.log(compare(b, c));
} else {
  if (!a) throw new Error('usage: report.js <run-dir>');
  console.log(writeReport(a, { title: `Load test — ${a.split('/').pop()}` }));
}
