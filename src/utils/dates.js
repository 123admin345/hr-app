/**
 * Calculates the number of working days between two dates (inclusive),
 * excluding weekends (Friday and Saturday for Saudi Arabia / Middle East).
 * Adjust WEEKEND_DAYS if your weekend is Saturday/Sunday.
 */
const WEEKEND_DAYS = [5, 6]; // 5 = Friday, 6 = Saturday

function countWorkingDays(startDateStr, endDateStr) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (!WEEKEND_DAYS.includes(dayOfWeek)) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }
  return count;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function generateRequestId() {
  return `REQ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

module.exports = { countWorkingDays, formatDate, generateRequestId };
