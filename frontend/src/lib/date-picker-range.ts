/** Years before today included in the date-picker dropdown. Matches react-day-picker's dropdown default. */
export const DATE_PICKER_PAST_YEARS = 100

/**
 * Years after today included in the date-picker dropdown.
 * react-day-picker caps dropdown years at the current year unless `endMonth` is set,
 * which blocked invoice due dates such as 2027.
 */
export const DATE_PICKER_FUTURE_YEARS = 10

export function getDatePickerMonthBounds(now: Date = new Date()): {
    startMonth: Date
    endMonth: Date
} {
    const year = now.getFullYear()
    return {
        startMonth: new Date(year - DATE_PICKER_PAST_YEARS, 0),
        endMonth: new Date(year + DATE_PICKER_FUTURE_YEARS, 11),
    }
}
