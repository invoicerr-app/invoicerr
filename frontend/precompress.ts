// Writes a `.gz` next to every compressible build file so nginx's `gzip_static` serves it as-is:
// compressed once at the highest level here instead of on every request. Brotli is not emitted, the
// official nginx image has no module to serve it.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { extname, join } from "node:path"
import { gzipSync } from "node:zlib"

const COMPRESSIBLE = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".svg",
  ".webmanifest",
  ".txt",
  ".xml",
])
// Same threshold as `gzip_min_length` in nginx.conf: below it the gzip framing eats the saving.
const MIN_BYTES = 1024

export interface PrecompressResult {
  files: number
  rawBytes: number
  gzipBytes: number
}

export function precompressDir(dir: string): PrecompressResult {
  const result: PrecompressResult = { files: 0, rawBytes: 0, gzipBytes: 0 }
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      const sub = precompressDir(path)
      result.files += sub.files
      result.rawBytes += sub.rawBytes
      result.gzipBytes += sub.gzipBytes
      continue
    }
    if (!COMPRESSIBLE.has(extname(name))) continue
    const raw = readFileSync(path)
    if (raw.length < MIN_BYTES) continue
    const gz = gzipSync(raw, { level: 9 })
    if (gz.length >= raw.length) continue
    writeFileSync(`${path}.gz`, gz)
    result.files += 1
    result.rawBytes += raw.length
    result.gzipBytes += gz.length
  }
  return result
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] ?? "dist"
  const { files, rawBytes, gzipBytes } = precompressDir(dir)
  console.log(`precompress: ${files} files in ${dir}, ${rawBytes} bytes -> ${gzipBytes} bytes gzip`)
}
