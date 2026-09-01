import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    DATE_PICKER_FUTURE_YEARS,
    DATE_PICKER_PAST_YEARS,
    getDatePickerMonthBounds,
} from "../src/lib/date-picker-range.ts"

describe("getDatePickerMonthBounds", () => {
    it("includes 2027 when the calendar is opened in 2025 (issue #251)", () => {
        const { startMonth, endMonth } = getDatePickerMonthBounds(new Date(2025, 11, 30))

        assert.equal(startMonth.getFullYear(), 2025 - DATE_PICKER_PAST_YEARS)
        assert.equal(startMonth.getMonth(), 0)
        assert.equal(endMonth.getFullYear(), 2025 + DATE_PICKER_FUTURE_YEARS)
        assert.equal(endMonth.getMonth(), 11)
        assert.ok(endMonth.getFullYear() >= 2027)
    })

    it("includes 2027 when the current year is 2026", () => {
        const { endMonth } = getDatePickerMonthBounds(new Date(2026, 0, 1))
        assert.ok(endMonth.getFullYear() >= 2027)
    })

    it("extends several years past the current year", () => {
        const now = new Date(2026, 5, 15)
        const { endMonth } = getDatePickerMonthBounds(now)
        assert.equal(endMonth.getFullYear(), now.getFullYear() + DATE_PICKER_FUTURE_YEARS)
        assert.ok(DATE_PICKER_FUTURE_YEARS >= 5)
    })

    it("uses today's year when no date is passed", () => {
        const currentYear = new Date().getFullYear()
        const { startMonth, endMonth } = getDatePickerMonthBounds()
        assert.equal(startMonth.getFullYear(), currentYear - DATE_PICKER_PAST_YEARS)
        assert.equal(endMonth.getFullYear(), currentYear + DATE_PICKER_FUTURE_YEARS)
    })
})
