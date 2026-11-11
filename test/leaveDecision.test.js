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
  assert.match(blocks[0].text.text, /action is being processed/);
  assert.match(blocks[0].text.text, /action button has been removed/);
  assert.equal(blocks.some((block) => block.type === 'actions'), false);
});

test('shows an approval as forwarded to final acknowledgement instead of final approval', () => {
  const blocks = processedDecisionBlocks({
    status: 'Pending Final Acknowledgement',
    leaveType: 'Annual',
    slackUserId: 'U-EMPLOYEE',
    employeeName: 'Sample Employee',
    startDate: '2026-10-01',
    endDate: '2026-10-02',
    totalDays: 2,
    managerId: 'U-DIRECT-MANAGER',
    nextStageLabel: 'Final Acknowledger',
    nextStageActionType: 'acknowledgement',
    approvalHistory: '✅ *Direct Manager:* Approved — Direct Manager: Sample Manager',
  });

  assert.match(blocks[0].text.text, /Leave Approval Forwarded/);
  assert.match(blocks[0].text.text, /Final Acknowledger/);
  assert.match(blocks[0].text.text, /final acknowledgement/);
  assert.match(blocks[0].text.text, /Route History/);
  assert.equal(blocks.some((block) => block.type === 'actions'), false);
});

test('shows a final acknowledgement as confirmation, not approval', () => {
  const blocks = processedDecisionBlocks({
    status: 'Approved',
    leaveType: 'Annual',
    slackUserId: 'U-EMPLOYEE',
    employeeName: 'Sample Employee',
    startDate: '2026-10-01',
    endDate: '2026-10-02',
    totalDays: 2,
    managerId: 'U-FINAL-ACKNOWLEDGER',
    finalActionType: 'acknowledgement',
  });

  assert.match(blocks[0].text.text, /Leave Confirmed/);
  assert.match(blocks[0].text.text, /Thank you for acknowledging/);
  assert.match(blocks[0].text.text, /Acknowledged by/);
  assert.equal(blocks.some((block) => block.type === 'actions'), false);
});

test('uses a Google Sheets single-cell claim before leave approval or rejection work', () => {
  const sheetsSource = fs.readFileSync(path.join(__dirname, '../src/utils/sheets.js'), 'utf8');
  const handlerSource = fs.readFileSync(path.join(__dirname, '../src/handlers/leaveHandler.js'), 'utf8');

  assert.match(sheetsSource, /async function claimLeaveRequestDecision/);
  assert.match(sheetsSource, /findReplace/);
  assert.match(sheetsSource, /matchEntireCell: true/);
  assert.match(sheetsSource, /startColumnIndex: 7/);
  assert.match(sheetsSource, /expectedStatus = 'Pending'/);
  assert.match(handlerSource, /claimLeaveRequestDecision\(requestId, stage\.processingStatus, stage\.pendingStatus\)/);
  assert.match(handlerSource, /claimLeaveRequestDecision\(requestId, 'Rejection Processing', stage\.pendingStatus\)/);
  assert.match(handlerSource, /async function completeFinalLeaveStep/);
  assert.match(handlerSource, /updateLeaveRequestApprovalData\(request\.requestId, \{ status: 'Approved' \}\)/);
});
