const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'leaveHandler.js'), 'utf8');
const sheetsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'sheets.js'), 'utf8');

test('claims the persisted current approval stage before processing a leave decision', () => {
  assert.match(handlerSource, /const companyHeadSlackId = companyHeadSlackIdFor\(employee\)/);
  assert.match(handlerSource, /getStageForLeaveRequest\(pendingRequest, employee, companyHeadSlackId\)/);
  assert.match(handlerSource, /getApproverIdForStage\(stage, employee, companyHeadSlackId\)/);
  assert.match(handlerSource, /claimLeaveRequestDecision\(requestId, stage\.processingStatus, stage\.pendingStatus\)/);
  assert.match(sheetsSource, /async function claimLeaveRequestDecision\(requestId, processingStatus, expectedStatus = 'Pending'\)/);
});

test('forwards an intermediate approval before any leave balance deduction', () => {
  const approvalStart = handlerSource.indexOf("app.action('approve_leave'");
  const forwardStart = handlerSource.indexOf('if (nextStage) {', approvalStart);
  const balanceStart = handlerSource.indexOf("if (request.leaveType === 'Annual')", approvalStart);

  assert.ok(forwardStart > approvalStart && forwardStart < balanceStart);
  assert.match(handlerSource.slice(forwardStart, balanceStart), /await _notifyLeaveApprover/);
  assert.match(handlerSource.slice(forwardStart, balanceStart), /return;/);
  assert.match(handlerSource, /await updateLeaveRequestApprovalData\(requestId, \{ status: 'Approved' \}\)/);
});

test('uses the same current-stage authorization for leave rejection', () => {
  const rejectionStart = handlerSource.indexOf("app.action('reject_leave'");
  const rejectionSubmitStart = handlerSource.indexOf("app.view('reject_feedback_submit'");

  assert.ok(rejectionStart >= 0 && rejectionSubmitStart > rejectionStart);
  assert.match(handlerSource.slice(rejectionStart, rejectionSubmitStart), /Only the assigned \$\{stage\.label\} can reject/);
  assert.match(handlerSource.slice(rejectionSubmitStart), /claimLeaveRequestDecision\(requestId, 'Rejection Processing', stage\.pendingStatus\)/);
  assert.match(handlerSource.slice(rejectionSubmitStart), /\[stage\.approvalField\]: rejectedRecord/);
});

test('prefers an employee company head over the group owner fallback', () => {
  assert.match(handlerSource, /function companyHeadSlackIdFor\(employee = \{\}\) \{\s+return employee\.companyHeadSlackId \|\| COMPANY_HEAD_SLACK_ID;/);
  assert.match(sheetsSource, /range: 'Employee Balances!A2:R'/);
  assert.match(sheetsSource, /companyHeadSlackId: row\[17\] \|\| ''/);
});

test('routes a configured two-level route directly from manager to company head', () => {
  const workflowSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'leaveApprovalWorkflow.js'), 'utf8');
  assert.match(workflowSource, /return \[APPROVAL_STAGES\.direct_manager_to_company_head, APPROVAL_STAGES\.company_head\]/);
  assert.match(workflowSource, /direct_manager_to_company_head:[\s\S]*approvedStatus: 'Pending Company Head Approval'/);
  assert.doesNotMatch(workflowSource, /department_head_final/);
});
