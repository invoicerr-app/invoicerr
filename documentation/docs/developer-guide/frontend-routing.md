---
sidebar_position: 16
---

# Frontend Routing

How the frontend (`frontend/src`) maps files to routes, and how it loads them.

## File-based routes

Routes come from the files under `src/pages/`, through
[generouted](https://github.com/oedotme/generouted). `main.tsx` renders `Routes` from
`@generouted/react-router/lazy`, and `src/router.ts` is generated: never edit it.

- `src/pages/(app)/...` is the signed-in app. Its `_layout.tsx` checks the session and wraps
  every page in the sidebar and header.
- `src/pages/auth/`, `portal/`, `legal/` and `(app)/signature/` are public.
- A folder or file starting with `_` (for example `_components/`) is not a route.
- Documents: `documents/[typeId]/index.tsx` is a type's list, `documents/[typeId]/new.tsx` the
  new-record page and `documents/[typeId]/[id].tsx` a record. The static `new` segment ranks above
  `[id]`. A caller that opens the new-record page pre-filled passes `state.initialData`.

Each page and layout is its own chunk, loaded the first time the route is visited. The entry
chunk only holds `main.tsx`, `_app.tsx` and what they import. While a page's chunk downloads,
React Router keeps the current page on screen; nothing goes blank.

## Background prefetch

Once the signed-in layout has rendered, `useRoutePrefetch` (`src/hooks/use-route-prefetch.ts`)
imports every route's chunk in the background, so the first visit of a page does not wait for
the network. The rules live in `src/lib/route-prefetch.ts`:

- It starts when the browser is idle (`requestIdleCallback`, or a one second timer where that
  does not exist), after the `load` event, and only while no React Query request is in flight.
- It loads two chunks at a time, top-level pages before nested ones.
- It does nothing when `navigator.connection.saveData` is on, or when the effective connection
  type is `2g` or `slow-2g`.
- A failed import is ignored: that page loads on click, as without prefetch.

It runs in the signed-in layout only, never on a public page: an anonymous visitor on the
sign-in, portal or signing pages would otherwise download the whole app.

When the service worker is active, it has already precached every chunk, so the prefetch is
served from the cache.

## `Catch` and `Pending` exports

Besides its default export, a page or layout file can export:

- `Catch`: the error boundary for that route. `src/pages/_app.tsx` exports the app-wide one
  ("Something went wrong" and a Reload button). It also catches a chunk that fails to load, for
  example in a tab still running a previous build after a deploy.
- `Pending`: rendered as the Suspense fallback while that route's component suspends.

`_app.tsx` is loaded eagerly, so its `Catch` works even when a route chunk cannot be fetched.

## Import cycles through barrels

`src/hooks/queries/index.ts` re-exports every query hook. A cycle through it is harmless in a
single bundle, but with one chunk per page Rollup may have to emit circular chunks, with a
broken execution order. This cycle did it:

```text
hooks/queries/index.ts -> use-document-types.ts -> document-conformity-section.tsx -> hooks/queries/index.ts
```

It produced 36 warnings during `vite build`, one per re-exported hook:

```text
Export "useAvailableDocumentTypes" of module "src/hooks/queries/use-document-types.ts" was
reexported through module "src/hooks/queries/index.ts" while both modules are dependencies of
each other and will end up in different chunks by current Rollup settings. [...] will likely
lead to broken execution order.
```

:::warning[Rule]
A module that a file in `hooks/queries/` imports must not import from `@/hooks/queries`. Import
the hook from its own file instead (`@/hooks/queries/use-document-types`).
:::

After a change that touches imports, run `npm run build` and check that this warning does not
appear.

## Dev server settings

`vite.config.ts` carries two settings for the dev server only; they have no effect on the build.

- `optimizeDeps.entries` lists `src/pages/**/*.tsx` (and `include` lists
  `@generouted/react-router/lazy`). Vite scans the entry files for dependencies to pre-bundle,
  and lazily imported pages are invisible to that scan. Without it, the dev server discovers a
  dependency on the first visit of a page and reloads the whole page, which breaks a Cypress spec
  running at that moment.
- `server.warmup.clientFiles` transforms the pages when the dev server starts, instead of on
  their first visit, which would otherwise count against the e2e specs' timeouts.

:::info[Adding a page]
New files under `src/pages/` are covered by both globs. A new dependency used only by a page is
picked up at the next dev server start.
:::
