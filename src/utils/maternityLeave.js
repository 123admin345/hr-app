/**
 * Maternity leave is three calendar months from the actual delivery date,
 * including that date. All arithmetic uses UTC date-only values. Eligibility
 * uses only the explicit employee flag; no demographic or legal policy inference.
 */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function isMaternityEligible(employee) {
  return employee?.maternityEligible === true;
}

function utcDate(year, monthIndex, day) {
  // Date.UTC treats years 0–99 as 1900–1999; setUTCFullYear does not.
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function parseGregorianDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = utcDate(year, month - 1, day);
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) return null;
  return date;
}

function dateOnlyString(date) {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * @param {string} deliveryDate Real Gregorian YYYY-MM-DD actual delivery date.
 * @returns {{startDate: string, endDate: string, returnDate: string, totalDays: number}}
 * @throws {RangeError} When deliveryDate is not a strict, real Gregorian date.
 */
function maternityLeavePeriod(deliveryDate) {
  const start = parseGregorianDate(deliveryDate);
  if (!start) throw new RangeError('Delivery date must be a valid Gregorian date in YYYY-MM-DD format.');

  // Move directly to the third-month anniversary, rather than repeatedly
  // adding one month (which can accidentally lose the original day of month).
  const targetMonth = utcDate(start.getUTCFullYear(), start.getUTCMonth() + 3, 1);
  const lastDayOfTargetMonth = utcDate(
    targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0,
  ).getUTCDate();
  const returnDate = utcDate(
    targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(),
    Math.min(start.getUTCDate(), lastDayOfTargetMonth),
  );
  const end = new Date(returnDate.getTime() - MILLISECONDS_PER_DAY);

  return {
    startDate: deliveryDate,
    endDate: dateOnlyString(end),
    returnDate: dateOnlyString(returnDate),
    totalDays: (returnDate.getTime() - start.getTime()) / MILLISECONDS_PER_DAY,
  };
}

function leaveDayUnit(leaveType) {
  return leaveType === 'Maternity' ? 'calendar day(s)' : 'working day(s)';
}

function leaveDurationLabel(leaveType, totalDays) {
  return `${totalDays} ${leaveDayUnit(leaveType)}`;
}

/**
 * Return a field-validation error, or an empty string on success. A caller may
 * pass its business-local YYYY-MM-DD today; the default is the current UTC day.
 * There is no arbitrary lookback or employee eligibility restriction here.
 */
function validateMaternityDeliveryDate(date, today = dateOnlyString(new Date())) {
  if (!parseGregorianDate(date)) {
    return 'Please select a valid actual delivery date (YYYY-MM-DD).';
  }
  if (!parseGregorianDate(today)) {
    return 'Unable to validate the delivery date against today. Please try again.';
  }
  if (date > today) {
    return 'The actual delivery date cannot be in the future. Enter the actual delivery date, not an estimated due date.';
  }
  return '';
}

/** The caller supplies requests for the relevant employee. */
function hasMaternityDateConflict(requests, deliveryDate) {
  if (!Array.isArray(requests) || !parseGregorianDate(deliveryDate)) return false;
  return requests.some((request) => request
    && request.leaveType === 'Maternity'
    && !['rejected', 'cancelled'].includes(String(request.status || '').trim().toLowerCase())
    && (request.deliveryDate === deliveryDate || request.startDate === deliveryDate));
}

module.exports = {
  isMaternityEligible,
  maternityLeavePeriod,
  leaveDayUnit,
  leaveDurationLabel,
  validateMaternityDeliveryDate,
  hasMaternityDateConflict,
};
