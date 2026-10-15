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

function addCalendarDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function addBusinessDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00`);
  let remaining = days;
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    if (!WEEKEND_DAYS.includes(date.getDay())) remaining -= 1;
  }
  return date.toISOString().split('T')[0];
}

function todayDateString() {
  return new Date().toISOString().split('T')[0];
}

function saudiTodayDateString() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function daysUntil(dateStr) {
  const today = new Date(`${todayDateString()}T00:00:00`);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

module.exports = {
  countWorkingDays,
  formatDate,
  generateRequestId,
  addCalendarDays,
  addBusinessDays,
  todayDateString,
  saudiTodayDateString,
  daysUntil,
};
