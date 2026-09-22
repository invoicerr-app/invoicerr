/**
 * Vitest global setup — loaded once per test file (see `test.setupFiles` in vite.config.ts).
 */
import "@testing-library/jest-dom/vitest"

// The REAL i18next instance, not a mock. Mocking `react-i18next` would make every assertion pass
// against a `t` that returns its own key, which proves nothing about interpolation: a component
// that dropped `{{years}}` on the floor would still look green. Importing the app's own instance
// costs one module load and means a component rendering a number is actually rendering it.
import "@/lib/i18n"
import { configure } from "@testing-library/dom"
import i18n from "i18next"

// Pin the language. The browser language detector would otherwise read jsdom's navigator (and, in
// CI, whatever the runner reports), so a spec could pass locally and fail elsewhere.
await i18n.changeLanguage("en")

// This codebase marks its testable nodes with `data-cy`, for Cypress. Pointing testing-library at
// the same attribute means unit and e2e tests break together when a hook is renamed, instead of
// the unit test silently passing on an attribute nobody else uses.
configure({ testIdAttribute: "data-cy" })
