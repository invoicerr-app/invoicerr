// Turns the `lhci upload --target=filesystem` output into a Markdown table (job summary, PR comment)
// and fails when a page ended on a different path than the one requested, which would mean the
// audit measured a redirect (sign-in) instead of the screen.
const fs = require('node:fs')
const path = require('node:path')

const dir = '.lighthouseci'
const out = path.join(dir, 'comment.md')
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
const pct = (v) => (v == null ? 'n/a' : String(Math.round(v * 100)))

let mismatches = 0
const rows = manifest.map((entry) => {
  const lhr = JSON.parse(fs.readFileSync(path.join(dir, path.basename(entry.jsonPath)), 'utf8'))
  const requested = new URL(entry.url).pathname
  const final = new URL(lhr.finalDisplayedUrl || lhr.finalUrl).pathname
  const ok = requested === final
  if (!ok) mismatches += 1
  const s = entry.summary
  return `| \`${requested}\` | \`${final}\`${ok ? '' : ' (redirected)'} | ${pct(s.performance)} | ${pct(s.accessibility)} | ${pct(s['best-practices'])} | ${pct(s.seo)} |`
})

fs.writeFileSync(
  out,
  [
    '<!-- lighthouse-ci-comment -->',
    '### Lighthouse CI',
    '',
    'Informative only. Logged-in screens of a seeded instance.',
    '',
    '| Page | Final URL | Performance | Accessibility | Best Practices | SEO |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'Full reports: the `lighthouse-report` artifact on this run.',
    '',
  ].join('\n'),
)

if (mismatches > 0) {
  console.error(`${mismatches} page(s) did not end on the requested path`)
  process.exit(1)
}
