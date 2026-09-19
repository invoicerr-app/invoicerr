# Fonts bundled for document branding

Closed set of five typefaces offered by the branding preset system (`branding/font-catalog.ts`) —
weights 400 (regular) and 700 (bold), Latin subset only (this product's rendered documents are
Latin-script), as static `.woff2` files. Each is licensed under the **SIL Open Font License,
version 1.1** — free to embed, distribute and subset, no attribution string required in the
rendered output itself (OFL doesn't require that; it does require the license text travel with the
font files, which is what this document — copied from each family's own `LICENSE` file — is for).

Downloaded from the `@fontsource/*` npm packages (version `5.3.0` of each, 2026-09-15) rather than
directly from fonts.google.com: fontsource repackages the exact same Google Fonts binaries as
plain static files with no build step, and its own package `LICENSE` file is the upstream font
license verbatim — reused here as this table's own "Copyright" column, not re-typed by hand.

| Family | Directory | Files | Copyright (from the font's own `LICENSE`) | Upstream |
| --- | --- | --- | --- | --- |
| Inter | `inter/` | `inter-400.woff2`, `inter-700.woff2` | The Inter Project Authors — https://github.com/rsms/inter | https://fonts.google.com/specimen/Inter · https://www.npmjs.com/package/@fontsource/inter |
| Source Serif 4 | `source-serif-4/` | `source-serif-4-400.woff2`, `source-serif-4-700.woff2` | Google Inc. | https://fonts.google.com/specimen/Source+Serif+4 · https://www.npmjs.com/package/@fontsource/source-serif-4 |
| IBM Plex Sans | `ibm-plex-sans/` | `ibm-plex-sans-400.woff2`, `ibm-plex-sans-700.woff2` | 2019 IBM Corp. | https://fonts.google.com/specimen/IBM+Plex+Sans · https://www.npmjs.com/package/@fontsource/ibm-plex-sans |
| DM Sans | `dm-sans/` | `dm-sans-400.woff2`, `dm-sans-700.woff2` | 2014 The DM Sans Project Authors — https://github.com/googlefonts/dm-fonts | https://fonts.google.com/specimen/DM+Sans · https://www.npmjs.com/package/@fontsource/dm-sans |
| Lora | `lora/` | `lora-400.woff2`, `lora-700.woff2` | 2011 The Lora Project Authors — https://github.com/cyrealtype/Lora-Cyrillic | https://fonts.google.com/specimen/Lora · https://www.npmjs.com/package/@fontsource/lora |

Full OFL 1.1 license text (identical for all five, only the copyright line above differs):
https://openfontlicense.org/open-font-license-official-text/

## Why these five

Coverage, not novelty — three sans (one geometric/neutral: Inter; one humanist: IBM Plex Sans; one
rounded/friendly: DM Sans), one slab-adjacent serif (Source Serif 4) and one classic text serif
(Lora), so the four shipped presets (`branding/presets.ts`) can each read as a genuinely different
document "voice" rather than four names pointing at near-identical grotesques.

## Loading — why a data URI, not a file path

`rendering/render-pdf.ts#renderPdf` feeds the whole document to Chromium via
`page.setContent(html, { waitUntil: 'domcontentloaded' })` — that file's own header states the
invariant this relies on: "every document this renderer receives is fully self-contained HTML …
There is no external network fetch this page could ever wait on". A `file://` path or a bare
`/fonts/...` URL would be exactly such a fetch (and `setContent` has no base URL to resolve a
relative path against at all), so a `@font-face` pointing at one would either hang past
`domcontentloaded` or silently fail to load depending on Chromium's own timing — indistinguishable
from a missing font. `render-html.ts#fontFaceFor` instead reads the `.woff2` bytes off disk once
(`readFileSync`, synchronous — this runs during HTML string assembly, before any browser is
involved) and inlines them as a `data:font/woff2;base64,...` URI directly in the `@font-face` rule,
the same technique `sepa-qr.ts#renderSepaQrDataUri` already uses for the embedded QR image. A
missing/unreadable file at read time never throws — `fontFaceFor` returns `null` and the render
falls back to the system font stack (see that function's own header) — a bundled font is a
presentation nicety, never a reason a document fails to render.

## `nest-cli.json`

`.woff2` is not covered by any of that file's pre-existing asset globs (`**/*.json`, `*.pem`,
`*.xsd`, `*.sch`) — a font file added under `fonts/` would sit in `src/` forever and never reach
`dist/`, the exact "watcher copies assets once at startup, a file added later never reaches the
running server" trap this repo's own `CLAUDE.md` already documents for `data/*.json` catalogs, and
just as fatal for a `nest build` (no watcher at all: an asset glob that doesn't match a file means
that file is simply never copied, in dev or in the shipped image). `nest-cli.json`'s `assets` array
therefore gained one more entry, `{ "include": "**/*.woff2", "outDir": "dist/src" }`, mirroring the
existing ones exactly.
