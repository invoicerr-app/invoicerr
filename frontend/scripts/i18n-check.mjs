#!/usr/bin/env node
/**
 * i18n consistency checker — generalized so both frontend (`translation.json`, one big catalog) and
 * backend (`mails.json`, one namespace per mail family under `src/mail/locales`) run the SAME
 * extraction/comparison logic instead of two hand-maintained copies drifting apart. Everything
 * project-specific is a CLI flag with a default that reproduces this script's original,
 * frontend-only behavior exactly — `node frontend/scripts/i18n-check.mjs` with no arguments is
 * unchanged, which is what `.github/workflows/cypress.yml`'s own `i18n-check` job still calls.
 *
 * - Extracts every static `t('...')` / `t("...")` / t(`...`) key from the `--src` tree.
 * - Template-literal keys containing `${...}` are treated as dynamic patterns:
 *   they cannot be checked key-by-key, so their static parts become regexes used
 *   to protect matching keys from being flagged as dead.
 * - Fails (exit 1) if any statically used key is missing from the source locale's catalog.
 * - Warns (exit 0) about: dead source-locale keys (defined but never referenced), and
 *   per-locale coverage vs the source locale.
 *
 * Flags:
 *   --src <dir>             directory to scan for t() calls, relative to this script's project root
 *                           (default: "src")
 *   --locales <dir>         directory holding one subfolder per language, relative to the project
 *                           root (default: "src/locales")
 *   --file <name>           catalog filename inside each language's subfolder (default:
 *                           "translation.json")
 *   --source-locale <lang>  the language folder that is the source of truth (default: "en")
 *   --external-prefix <p>   a key prefix to treat as "used" even with no static `t()` call found for
 *                           it (repeatable) — e.g. a key sent as plain data by another project. With
 *                           no `--src`/`--locales`/`--file` override this defaults to the one prefix
 *                           the frontend catalog has always needed; pass an empty run of this project
 *                           has none.
 *   --report                print a JSON report (missing keys + fallbacks, dead keys, coverage)
 *   --quiet                 only print errors
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
    const opts = {
        src: 'src',
        locales: 'src/locales',
        file: 'translation.json',
        sourceLocale: 'en',
        externalPrefixes: [],
        report: false,
        quiet: false,
    }
    let sawExternalPrefix = false
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--report') opts.report = true
        else if (arg === '--quiet') opts.quiet = true
        else if (arg === '--src') opts.src = argv[++i]
        else if (arg === '--locales') opts.locales = argv[++i]
        else if (arg === '--file') opts.file = argv[++i]
        else if (arg === '--source-locale') opts.sourceLocale = argv[++i]
        else if (arg === '--external-prefix') {
            if (!sawExternalPrefix) {
                opts.externalPrefixes = []
                sawExternalPrefix = true
            }
            opts.externalPrefixes.push(argv[++i])
        } else throw new Error(`i18n-check: unknown argument "${arg}"`)
    }
    // Nothing on the command line asked to scope this run away from the frontend's own tree — keep
    // the one prefix that tree has always needed instead of silently dropping it.
    if (!sawExternalPrefix && opts.src === 'src' && opts.locales === 'src/locales') {
        opts.externalPrefixes = [
            // backend/src/modules/plugins/plugins.service.ts sends these keys to
            // webhook-instructions-modal.tsx as plain data.
            'webhook.instructions.',
        ]
    }
    return opts
}

const opts = parseArgs(process.argv.slice(2))
const SRC_DIR = path.join(PROJECT_ROOT, opts.src)
const LOCALES_DIR = path.join(PROJECT_ROOT, opts.locales)
const SOURCE_LOCALE = opts.sourceLocale
const EN_FILE = path.join(LOCALES_DIR, SOURCE_LOCALE, opts.file)
const CATALOG_FILE_NAME = opts.file
const EXTERNAL_KEY_PREFIXES = opts.externalPrefixes

const REPORT = opts.report
const QUIET = opts.quiet || REPORT

/* ---------- helpers ---------- */

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || full === LOCALES_DIR) continue
            walk(full, out)
        } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
            out.push(full)
        }
    }
    return out
}

function flatten(obj, prefix = '', out = {}) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k
        if (v !== null && typeof v === 'object') flatten(v, key, out)
        else out[key] = v
    }
    return out
}

/* ---------- extraction ---------- */

// t("key"), t('key'), t(`key`), with optional string fallback as 2nd arg.
const T_CALL_RE = /\bt\(\s*(['"`])((?:\\.|(?!\1).)+?)\1\s*(?:,\s*(['"`])((?:\\.|(?!\3).)*?)\3)?/gs

// Good-enough comment stripping so JSDoc examples don't register as usages.
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const staticKeys = new Map() // key -> fallback | null
const dynamicPatterns = new Map() // raw template -> { regex, file }

for (const file of walk(SRC_DIR)) {
    const source = stripComments(fs.readFileSync(file, 'utf8'))
    for (const match of source.matchAll(T_CALL_RE)) {
        const [, quote, rawKey, fallbackQuote, rawFallback] = match
        const key = rawKey.replace(/\\(.)/g, '$1')
        if (quote === '`' && key.includes('${')) {
            if (!dynamicPatterns.has(key)) {
                const regex = new RegExp(
                    '^' +
                        key
                            .split(/\$\{[^}]*\}/)
                            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                            .join('.+') +
                        '$'
                )
                dynamicPatterns.set(key, { regex, file: path.relative(PROJECT_ROOT, file) })
            }
            continue
        }
        // Skip obvious non-keys (defensive: interpolated fallback strings, spaces…)
        if (!/^[\w-]+(\.[\w-]+)*$/.test(key)) continue
        const fallback = fallbackQuote && fallbackQuote !== '`' ? rawFallback.replace(/\\(.)/g, '$1') : null
        if (!staticKeys.has(key) || (fallback && !staticKeys.get(key))) {
            staticKeys.set(key, fallback)
        }
    }
}

/* ---------- load locales ---------- */

const en = flatten(JSON.parse(fs.readFileSync(EN_FILE, 'utf8')))
const enKeys = new Set(Object.keys(en))

const locales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== SOURCE_LOCALE)
    .map((e) => e.name)
    .sort()

/* ---------- checks ---------- */

// 1. Used keys missing from EN (hard failure).
const missing = [...staticKeys.keys()].filter((k) => !enKeys.has(k)).sort()

// 2. Dead EN keys: not statically used, not matching a dynamic pattern, not an
//    external key, and not present as a quoted literal anywhere in the sources
//    (keys are sometimes stored in data structures and passed to t() later).
const corpus = walk(SRC_DIR)
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n')
const patternList = [...dynamicPatterns.values()].map((p) => p.regex)
const isProtected = (key) =>
    staticKeys.has(key) ||
    EXTERNAL_KEY_PREFIXES.some((p) => key.startsWith(p)) ||
    patternList.some((re) => re.test(key)) ||
    corpus.includes(`'${key}'`) ||
    corpus.includes(`"${key}"`) ||
    corpus.includes('`' + key + '`')
const dead = [...enKeys].filter((k) => !isProtected(k)).sort()

// 3. Per-locale coverage vs EN (warn only). A key counts as translated when it
//    exists; identical-to-EN values are reported separately (often legitimate:
//    "Email", "Total", proper nouns…).
const coverage = {}
for (const locale of locales) {
    const data = flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, CATALOG_FILE_NAME), 'utf8')))
    const keys = Object.keys(data)
    const present = keys.filter((k) => enKeys.has(k))
    const extra = keys.filter((k) => !enKeys.has(k))
    const sameAsEn = present.filter((k) => data[k] === en[k])
    coverage[locale] = {
        present: present.length,
        total: enKeys.size,
        pct: Math.round((present.length / enKeys.size) * 1000) / 10,
        extraKeys: extra.length,
        identicalToEn: sameAsEn.length,
    }
}

/* ---------- output ---------- */

if (REPORT) {
    console.log(
        JSON.stringify(
            {
                usedStaticKeys: staticKeys.size,
                dynamicPatterns: [...dynamicPatterns.entries()].map(([raw, { file }]) => ({ raw, file })),
                missingInEn: missing.map((k) => ({ key: k, fallback: staticKeys.get(k) })),
                deadEnKeys: dead,
                coverage,
            },
            null,
            2
        )
    )
} else if (!QUIET) {
    const sourceLabel = SOURCE_LOCALE.toUpperCase()
    console.log(`i18n-check: ${staticKeys.size} static keys used, ${dynamicPatterns.size} dynamic patterns, ${enKeys.size} keys defined in ${sourceLabel}`)
    if (dynamicPatterns.size > 0) {
        console.log(`\nDynamic (unverifiable) key patterns:`)
        for (const [raw, { file }] of dynamicPatterns) console.log(`  - ${raw}  (${file})`)
    }
    if (dead.length > 0) {
        console.log(`\nWarning: ${dead.length} ${sourceLabel} keys appear unused (defined but never referenced).`)
    }
    console.log(`\nCoverage vs ${sourceLabel} (${enKeys.size} keys):`)
    for (const [locale, c] of Object.entries(coverage)) {
        console.log(`  ${locale.padEnd(8)} ${String(c.pct).padStart(5)}%  (${c.present}/${c.total}${c.extraKeys ? `, ${c.extraKeys} extra` : ''})`)
    }
}

if (missing.length > 0) {
    console.error(`\ni18n-check FAILED: ${missing.length} used key(s) missing from ${SOURCE_LOCALE}/${CATALOG_FILE_NAME}:`)
    for (const k of missing) console.error(`  - ${k}`)
    process.exit(1)
}

if (!QUIET) console.log(`\ni18n-check passed: every statically used key is defined in ${SOURCE_LOCALE.toUpperCase()}.`)
