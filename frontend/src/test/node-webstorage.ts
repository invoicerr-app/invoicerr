/**
 * Node 26 defines `localStorage`/`sessionStorage` globals (WebStorage). Without
 * `--localstorage-file` their value is `undefined`, and Vitest's jsdom environment copies that
 * `undefined` onto the window, shadowing the working `Storage` instances jsdom built for it. A spec
 * calling bare `localStorage.clear()` then crashes on Node 26 while passing on Node 24, and the
 * "works without storage" spec that spies on `Storage.prototype` no longer sees its spy.
 *
 * jsdom keeps the real instances on `window._localStorage` / `window._sessionStorage`; put those
 * back. Loaded before `setup.ts` (see `test.setupFiles` in `vite.config.ts`), so every spec and
 * every imported module sees them from the first line.
 */
const jsdomWindow = window as unknown as Record<string, unknown>

for (const [key, storageKey] of [
  ["localStorage", "_localStorage"],
  ["sessionStorage", "_sessionStorage"],
] as const) {
  if (jsdomWindow[key]) continue
  const storage = jsdomWindow[storageKey]
  if (!storage) continue
  Object.defineProperty(globalThis, key, {
    value: storage,
    configurable: true,
    writable: true,
  })
}
