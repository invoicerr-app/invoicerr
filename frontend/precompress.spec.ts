import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"
import { precompressDir } from "./precompress.ts"

describe("precompressDir", () => {
  let dir: string

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("writes a .gz that decompresses to the original for compressible files, recursively", () => {
    dir = mkdtempSync(join(tmpdir(), "precompress-"))
    mkdirSync(join(dir, "assets"))
    const bundle = "console.log('bundle');\n".repeat(200)
    writeFileSync(join(dir, "assets", "index.js"), bundle)

    const result = precompressDir(dir)

    expect(result.files).toBe(1)
    expect(gunzipSync(readFileSync(join(dir, "assets", "index.js.gz"))).toString()).toBe(bundle)
    expect(result.gzipBytes).toBeLessThan(result.rawBytes)
  })

  it("skips small files, already compressed formats and existing .gz files", () => {
    dir = mkdtempSync(join(tmpdir(), "precompress-"))
    writeFileSync(join(dir, "small.js"), "x")
    writeFileSync(join(dir, "font.woff2"), Buffer.alloc(4096, 1))
    writeFileSync(join(dir, "big.css"), "a{color:red}\n".repeat(200))

    precompressDir(dir)
    const second = precompressDir(dir)

    expect(existsSync(join(dir, "small.js.gz"))).toBe(false)
    expect(existsSync(join(dir, "font.woff2.gz"))).toBe(false)
    expect(existsSync(join(dir, "big.css.gz.gz"))).toBe(false)
    expect(second.files).toBe(1)
  })
})
