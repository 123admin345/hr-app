const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'leaveHandler.js'), 'utf8');
const sheetsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'sheets.js'), 'utf8');
const workflowSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'leaveApprovalWorkflow.js'), 'utf8');

test('claims the persisted current approval or acknowledgement stage before a leave action', () => {
  assert.match(handlerSource, /const finalAcknowledgerSlackId = finalAcknowledgerSlackIdFor\(employee\)/);
  assert.match(handlerSource, /getStageForLeaveRequest\(pendingRequest, employee, finalAcknowledgerSlackId\)/);
  assert.match(handlerSource, /getApproverIdForStage\(stage, employee, finalAcknowledgerSlackId\)/);
  assert.match(handlerSource, /claimLeaveRequestDecision\(requestId, stage\.processingStatus, stage\.pendingStatus\)/);
  assert.match(sheetsSource, /async function claimLeaveRequestDecision\(requestId, processingStatus, expectedStatus = 'Pending'\)/);
});

test('forwards every intermediate approval before any leave balance deduction', () => {
  const approvalStart = handlerSource.indexOf("app.action('approve_leave'");
  const forwardStart = handlerSource.indexOf('if (nextStage) {', approvalStart);
  const completeStart = handlerSource.indexOf('completeFinalLeaveStep({', approvalStart);

  assert.ok(forwardStart > approvalStart && forwardStart < completeStart);
  assert.match(handlerSource.slice(forwardStart, completeStart), /await _notifyLeaveApprover/);
  assert.match(handlerSource.slice(forwardStart, completeStart), /return;/);
  assert.match(handlerSource, /async function completeFinalLeaveStep/);
  assert.match(handlerSource, /await updateLeaveRequestApprovalData\(request\.requestId, \{ status: 'Approved' \}\)/);
});

test('uses the same current-stage authorization for leave rejection and blocks acknowledgement rejection', () => {
  const rejectionStart = handlerSource.indexOf("app.action('reject_leave'");
  const rejectionSubmitStart = handlerSource.indexOf("app.view('reject_feedback_submit'");

  assert.ok(rejectionStart >= 0 && rejectionSubmitStart > rejectionStart);
  assert.match(handlerSource.slice(rejectionStart, rejectionSubmitStart), /stage\.actionType !== 'approval'/);
  assert.match(handlerSource.slice(rejectionStart, rejectionSubmitStart), /acknowledgement only/);
  assert.match(handlerSource.slice(rejectionSubmitStart), /claimLeaveRequestDecision\(requestId, 'Rejection Processing', stage\.pendingStatus\)/);
  assert.match(handlerSource.slice(rejectionSubmitStart), /\[stage\.recordField\]: rejectedRecord/);
});

test('uses an employee-specific final acknowledger instead of a company-title role', () => {
  assert.match(handlerSource, /function finalAcknowledgerSlackIdFor\(employee = \{\}\) \{\s+return employee\.finalAcknowledgerSlackId \|\| FINAL_ACKNOWLEDGER_SLACK_ID;/);
  assert.match(sheetsSource, /range: 'Employee Balances!A2:R'/);
  assert.match(sheetsSource, /finalAcknowledgerSlackId: row\[17\] \|\| ''/);
  assert.doesNotMatch(handlerSource, /Company Head/);
});

test('renders one acknowledgement button and registers a protected acknowledgement handler', () => {
  assert.match(handlerSource, /action_id: 'acknowledge_leave'/);
  assert.match(handlerSource, /text: \{ type: 'plain_text', text: '✅ Acknowledge', emoji: true \}/);
  assert.match(handlerSource, /app\.action\('acknowledge_leave'/);
  assert.match(handlerSource, /Only the assigned Final Acknowledger can acknowledge/);
  assert.match(handlerSource, /finalActionType: 'acknowledgement'/);
  assert.doesNotMatch(workflowSource, /Company Head/);
});
