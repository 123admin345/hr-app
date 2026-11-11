const { formatDate } = require('./dates');

function isFutureDate(dateString, todayDateString) {
  return Boolean(dateString && todayDateString && dateString > todayDateString);
}

function isEmployeeCancelableLeave(request, employeeSlackId, todayDateString) {
  return Boolean(
    request
    && request.status === 'Approved'
    && request.slackUserId === employeeSlackId
    && isFutureDate(request.startDate, todayDateString),
  );
}

function restoredLeaveBalances(employee, request) {
  const totalDays = Number(request.totalDays || 0);

  if (request.leaveType === 'Annual') {
    return {
      annualUsed: Math.max(0, employee.annualUsed - totalDays),
      annualRemaining: employee.annualRemaining + totalDays,
      summary: `${totalDays} annual leave day(s) restored`,
    };
  }

  if (request.leaveType === 'Sick') {
    return {
      sickUsed: Math.max(0, employee.sickUsed - totalDays),
      summary: `${totalDays} sick leave day(s) removed from used balance`,
    };
  }

  if (request.leaveType === 'Hajj') {
    return {
      hajjUsed: 0,
      summary: 'Hajj leave eligibility restored',
    };
  }

  throw new Error(`Unsupported leave type for cancellation: ${request.leaveType}`);
}

function cancellationSummaryForEmployee(request, restoredBalances) {
  if (request.leaveType === 'Annual') {
    return `Your annual leave balance is now *${restoredBalances.annualRemaining} day(s)*.`;
  }

  if (request.leaveType === 'Sick') {
    return `Your sick leave used balance is now *${restoredBalances.sickUsed} day(s)*.`;
  }

  return 'Your Hajj leave eligibility has been restored because the leave was cancelled before it started.';
}

function cancellationOptionText(request) {
  return `${request.leaveType}: ${formatDate(request.startDate)} – ${formatDate(request.endDate)} (${request.totalDays} day(s))`;
}

module.exports = {
  isFutureDate,
  isEmployeeCancelableLeave,
  restoredLeaveBalances,
  cancellationSummaryForEmployee,
  cancellationOptionText,
};
