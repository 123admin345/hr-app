const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('removes leave actions immediately while an approval is being processed', () => {
  const blocks = processedDecisionBlocks({
    status: 'Approval Processing',
    leaveType: 'Annual',
    slackUserId: 'U-EMPLOYEE',
    employeeName: 'Sample Employee',
    startDate: '2026-10-01',
    endDate: '2026-10-02',
    totalDays: 2,
    managerId: 'U-MANAGER',
  });

  assert.equal(blocks.length, 1);
  assert.match(blocks[0].text.text, /decision is being processed/);
  assert.match(blocks[0].text.text, /buttons have been removed/);
  assert.equal(blocks.some((block) => block.type === 'actions'), false);
});

test('uses a Google Sheets single-cell claim before leave approval or rejection work', () => {
  const sheetsSource = fs.readFileSync(path.join(__dirname, '../src/utils/sheets.js'), 'utf8');
  const handlerSource = fs.readFileSync(path.join(__dirname, '../src/handlers/leaveHandler.js'), 'utf8');

  assert.match(sheetsSource, /async function claimLeaveRequestDecision/);
  assert.match(sheetsSource, /findReplace/);
  assert.match(sheetsSource, /matchEntireCell: true/);
  assert.match(sheetsSource, /startColumnIndex: 7/);
  assert.match(handlerSource, /claimLeaveRequestDecision\(requestId, 'Approval Processing'\)/);
  assert.match(handlerSource, /claimLeaveRequestDecision\(requestId, 'Rejection Processing'\)/);
  assert.match(handlerSource, /Use the current employee row, not balance values stored in an older Slack button/);
});
