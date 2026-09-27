const test = require('node:test');
const assert = require('node:assert/strict');
const { processedDecisionBlocks } = require('../src/utils/leaveDecision');

test('replaces completed leave decisions with final status content and no action buttons', () => {
  const blocks = processedDecisionBlocks({
    status: 'Approved',
    leaveType: 'Annual',
    slackUserId: 'U-EMPLOYEE',
    employeeName: 'Sample Employee',
    startDate: '2026-10-01',
    endDate: '2026-10-02',
    totalDays: 2,
    managerId: 'U-MANAGER',
  });

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'section');
  assert.match(blocks[0].text.text, /Thank you for approving this request/);
  assert.equal(blocks.some((block) => block.type === 'actions'), false);
});

test('shows rejection feedback in the final manager decision content', () => {
  const blocks = processedDecisionBlocks({
    status: 'Rejected',
    leaveType: 'Sick',
    slackUserId: 'U-EMPLOYEE',
    employeeName: 'Sample Employee',
    startDate: '2026-10-01',
    endDate: '2026-10-02',
    totalDays: 2,
    managerId: 'U-MANAGER',
    reason: 'Please provide a clearer report.',
  });

  assert.match(blocks[0].text.text, /Please provide a clearer report/);
  assert.match(blocks[0].text.text, /employee has been notified/);
});
