const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isEmployeeCancelableLeave,
  restoredLeaveBalances,
  cancellationSummaryForEmployee,
} = require('../src/utils/leaveCancellation');
const { processedDecisionBlocks } = require('../src/utils/leaveDecision');

test('allows only the employee to cancel an approved leave before its Saudi start date', () => {
  const request = {
    requestId: 'REQ-FUTURE',
    status: 'Approved',
    slackUserId: 'U-EMPLOYEE',
    startDate: '2026-10-15',
  };

  assert.equal(isEmployeeCancelableLeave(request, 'U-EMPLOYEE', '2026-10-14'), true);
  assert.equal(isEmployeeCancelableLeave(request, 'U-OTHER', '2026-10-14'), false);
  assert.equal(isEmployeeCancelableLeave(request, 'U-EMPLOYEE', '2026-10-15'), false);
  assert.equal(isEmployeeCancelableLeave({ ...request, status: 'Pending' }, 'U-EMPLOYEE', '2026-10-14'), false);
});

test('restores the correct annual leave balance after future approved leave is cancelled', () => {
  const result = restoredLeaveBalances(
    { annualUsed: 8, annualRemaining: 13 },
    { leaveType: 'Annual', totalDays: 3 },
  );

  assert.deepEqual(result, {
    annualUsed: 5,
    annualRemaining: 16,
    summary: '3 annual leave day(s) restored',
  });
  assert.match(
    cancellationSummaryForEmployee({ leaveType: 'Annual' }, result),
    /16 day\(s\)/,
  );
});

test('restores sick and Hajj leave records without creating negative balances', () => {
  const sick = restoredLeaveBalances(
    { sickUsed: 1 },
    { leaveType: 'Sick', totalDays: 3 },
  );
  const hajj = restoredLeaveBalances(
    { hajjUsed: 1 },
    { leaveType: 'Hajj', totalDays: 10 },
  );

  assert.equal(sick.sickUsed, 0);
  assert.equal(hajj.hajjUsed, 0);
});

test('shows a neutral cancelled status if a manager clicks an old leave button', () => {
  const blocks = processedDecisionBlocks({
    status: 'Cancelled',
    leaveType: 'Annual',
    slackUserId: 'U-EMPLOYEE',
    employeeName: 'Sample Employee',
    startDate: '2026-10-15',
    endDate: '2026-10-17',
    totalDays: 3,
    managerId: 'U-MANAGER',
  });

  assert.match(blocks[0].text.text, /Leave Cancelled/);
  assert.match(blocks[0].text.text, /employee, manager, and HR have been notified/);
  assert.equal(blocks.some((block) => block.type === 'actions'), false);
});
