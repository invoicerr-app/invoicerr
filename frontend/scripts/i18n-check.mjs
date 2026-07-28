#!/usr/bin/env node
/**
 * i18n consistency checker.
 *
 * - Extracts every static `t('...')` / `t("...")` / t(`...`) key from frontend/src.
 * - Template-literal keys containing `${...}` are treated as dynamic patterns:
 *   they cannot be checked key-by-key, so their static parts become regexes used
 *   to protect matching keys from being flagged as dead.
 * - Fails (exit 1) if any statically used key is missing from en/translation.json.
 * - Warns (exit 0) about: dead EN keys (defined but never referenced), and
 *   per-locale coverage vs EN.
 *
 * Flags:
 *   --report   print a JSON report (missing keys + fallbacks, dead keys, coverage)
 *   --quiet    only print errors
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = path.resolve(__dirname, '..')
const SRC_DIR = path.join(FRONTEND_ROOT, 'src')
const LOCALES_DIR = path.join(SRC_DIR, 'locales')
const EN_FILE = path.join(LOCALES_DIR, 'en', 'translation.json')

// Keys referenced outside frontend/src (e.g. sent by the backend as data) or
// otherwise invisible to static extraction. Prefixes: everything under them is
// considered "used".
const EXTERNAL_KEY_PREFIXES = [
    // backend/src/modules/plugins/plugins.service.ts sends these keys to
    // webhook-instructions-modal.tsx as plain data.
    'webhook.instructions.',
]

const args = new Set(process.argv.slice(2))
const REPORT = args.has('--report')
const QUIET = args.has('--quiet') || REPORT

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
                dynamicPatterns.set(key, { regex, file: path.relative(FRONTEND_ROOT, file) })
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
    .filter((e) => e.isDirectory() && e.name !== 'en')
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
    const data = flatten(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, 'translation.json'), 'utf8')))
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
    console.log(`i18n-check: ${staticKeys.size} static keys used, ${dynamicPatterns.size} dynamic patterns, ${enKeys.size} keys defined in EN`)
    if (dynamicPatterns.size > 0) {
        console.log(`\nDynamic (unverifiable) key patterns:`)
        for (const [raw, { file }] of dynamicPatterns) console.log(`  - ${raw}  (${file})`)
    }
    if (dead.length > 0) {
        console.log(`\nWarning: ${dead.length} EN keys appear unused (defined but never referenced).`)
    }
    console.log(`\nCoverage vs EN (${enKeys.size} keys):`)
    for (const [locale, c] of Object.entries(coverage)) {
        console.log(`  ${locale.padEnd(8)} ${String(c.pct).padStart(5)}%  (${c.present}/${c.total}${c.extraKeys ? `, ${c.extraKeys} extra` : ''})`)
    }
}

if (missing.length > 0) {
    console.error(`\ni18n-check FAILED: ${missing.length} used key(s) missing from en/translation.json:`)
    for (const k of missing) console.error(`  - ${k}`)
    process.exit(1)
}

if (!QUIET) console.log('\ni18n-check passed: every statically used key is defined in EN.')
