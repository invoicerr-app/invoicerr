---
sidebar_position: 0
---

# Manual Installation (Local Development)

## Prerequisites

- Node.js — the app itself (NestJS 12) boots on v20.19+, but the backend test runner (Vitest 5)
  refuses to start below v22.12, so use **v22.12+** to actually run `npm test`.
- PostgreSQL — the repo ships `docker-compose.dev.yml` to start one locally (also Redis and Mailpit), or point `DATABASE_URL` at your own instance
- npm

## Steps

1. Clone the project:

   ```bash
   git clone https://github.com/invoicerr-app/invoicerr.git
   cd invoicerr
   ```

2. Backend setup:

   ```bash
   cd backend
   npm install
   npx prisma generate
   npm run start
   ```

   PDF generation (every document type shares one renderer — quotes, invoices, credit notes,
   expenses, received invoices, purchase orders, goods receipts) needs a Chromium/Chrome binary. Outside
   the Docker image nothing provides one automatically, so run `npx playwright-core install chromium`
   once to fetch a matching build — or point `CHROMIUM_EXECUTABLE_PATH` at a browser you already have
   (see `backend/.env.example`).

3. Frontend setup, in a new terminal:

   ```bash
   cd frontend
   npm install
   npm run start
   ```

4. Open in your browser:
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:3000`

## Running end-to-end tests (Cypress)

1. Start the backend and frontend with the test environment variables:

   ```bash
   cd backend && npm run start:test &
   cd frontend && npm run start:test &
   ```

   Make sure you have a `.env.test` file in each directory.

2. In another terminal, run Cypress:

   ```bash
   cd e2e
   npm install
   npm run e2e:open # or npm run e2e:run
   ```

In CI, the GitHub Actions workflow runs these steps automatically.

### Time limits

Cypress has no per-test timeout of its own, so the suite adds two:

- A test that runs longer than 180 seconds fails at its next command with a "time limit" error
  (`e2e/cypress/support/test-time-limit.ts`).
- In CI, `e2e/scripts/run-specs.sh` runs each spec in its own Cypress process under a hard limit of
  15 minutes (`SPEC_TIMEOUT_MIN` to change it). A spec whose browser stops answering is killed and
  reported as failed, and the remaining specs still run. You can use it locally too:
  `scripts/run-specs.sh cypress/e2e/05-clients.cy.ts,cypress/e2e/09-settings.cy.ts --browser firefox`.

## Right-to-left (RTL) layout

The frontend mirrors its layout for right-to-left locales instead of only translating the text.

- **Which locales are RTL** is an explicit list, `RTL_LOCALES` in `frontend/src/lib/i18n.ts`
  (`ar`, `he`, `fa`, `ur`). It is never guessed from the script of the active catalog, so adding a
  locale whose code is not on that list (even one written right-to-left) keeps the layout
  left-to-right until the list is updated. `isRtlLocale()` in the same file is what every other
  RTL decision (the document's own `dir`, which edge the sidebar docks to, which icons flip) reads.
- **Tailwind classes are logical, not physical.** Use `ms-`/`me-` instead of `ml-`/`mr-`,
  `ps-`/`pe-` instead of `pl-`/`pr-`, `start-`/`end-` instead of `left-`/`right-`,
  `text-start`/`text-end` instead of `text-left`/`text-right`, and `rounded-s`/`rounded-e` (or the
  four-corner `rounded-ss`/`rounded-se`/`rounded-es`/`rounded-ee`) instead of the physical corner
  utilities. A handful of places stay physical on purpose and are not a gap to fix:
  - a numeric table/list column (an amount, a quantity, a rate) keeps `text-right`, since issue
    #559 treats number alignment as a deliberate exception rather than something that should track
    reading direction;
  - `components/ui/sidebar.tsx`'s own dock-side geometry (`SidebarRail`, the container's
    `left-0`/`right-0`, its `border-l`/`border-r`) and `components/ui/sheet.tsx`'s matching
    side-conditional block are keyed to the component's own `side` prop (`"left" | "right"`), an
    independent concept from text direction. `components/sidebar.tsx` is what makes the app's own
    sidebar RTL-aware, by choosing `side="right"` for an RTL locale instead of asking the
    primitive to guess from `dir`;
  - `components/ui/input-otp.tsx`'s digit-box borders stay physical because a one-time code is a
    numeric identifier, always read left-to-right regardless of UI language.
- **A value that must stay left-to-right inside RTL text** (a monetary amount, a date, an IBAN, a
  VAT/SIRET/other identifier) is wrapped with `dir="ltr"`, either directly on the element, or
  through the shared `<LtrValue>` component (`components/ui/ltr-value.tsx`) for inline amounts.
  Plain `unicode-bidi: isolate` is not enough on its own: it keeps the value's own character order
  stable but still lets the bidi algorithm place the whole run, and decide where a leading minus
  sign or a currency code lands, based on the surrounding RTL text.
- **Directional icons** (a chevron, an arrow, a back button) flip with the `rtl:` Tailwind variant,
  for example `className="... rtl:rotate-180"`, the same pattern `components/ui/calendar.tsx`
  already used for its own previous/next chevrons before issue #559.

### Testing RTL locally

No Arabic, Hebrew, Persian or Urdu translation exists yet. `frontend/src/lib/i18n.ts` registers a
dev-only locale, `rtltest`, that copies the English catalog under a right-to-left code, built only
when `import.meta.env.DEV` is true, so it never reaches a `vite build` output. To try it:

1. Run the frontend in dev mode (`npm run dev` or `npm run start:test`).
2. In the browser console or devtools storage panel, set `localStorage.i18nextLng = "rtltest"` and
   reload the page (changing the key alone does not re-render a mounted page).
3. The document switches to `dir="rtl"`, the sidebar docks to the right, and every value wrapped in
   `dir="ltr"` keeps reading left-to-right.

`e2e/cypress/e2e/116-rtl-layout.cy.ts` drives the same locale through Cypress, the same way
`73-account-page.cy.ts` drives a real language switch: writing `i18nextLng` to `localStorage`, then
a real `cy.reload()`.

:::info[Adding a real RTL translation]
Once an Arabic, Hebrew, Persian or Urdu catalog is complete enough to list in
`SUPPORTED_LANGUAGES`, no other change is needed here: its code is already in `RTL_LOCALES`, and
the mechanism above already reads from that list.
:::
