const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getLeaveApprovalStages,
  getStageForLeaveRequest,
  getApproverIdForStage,
  approvalRouteText,
  approvalRecord,
  approvalTrailText,
} = require('../src/utils/leaveApprovalWorkflow');

const threeLevelEmployee = {
  name: 'Sample Employee',
  managerSlackId: 'U-DIRECT-MANAGER',
  departmentHeadSlackId: 'U-DEPARTMENT-HEAD',
  leaveApprovalRoute: '3-Level',
};

test('uses the current one-manager leave route by default', () => {
  const stages = getLeaveApprovalStages({ managerSlackId: 'U-MANAGER' }, 'U-COMPANY-HEAD');
  assert.equal(stages.length, 1);
  assert.equal(stages[0].key, 'final_manager');
  assert.equal(stages[0].pendingStatus, 'Pending');
  assert.equal(stages[0].approvedStatus, 'Approved');
});

test('routes configured employees through direct manager, department head, then company head', () => {
  const stages = getLeaveApprovalStages(threeLevelEmployee, 'U-COMPANY-HEAD');
  assert.deepEqual(stages.map((stage) => stage.key), ['direct_manager', 'department_head', 'company_head']);
  assert.deepEqual(stages.map((stage) => stage.pendingStatus), [
    'Pending',
    'Pending Department Head Approval',
    'Pending Company Head Approval',
  ]);
  assert.equal(getApproverIdForStage(stages[0], threeLevelEmployee, 'U-COMPANY-HEAD'), 'U-DIRECT-MANAGER');
  assert.equal(getApproverIdForStage(stages[1], threeLevelEmployee, 'U-COMPANY-HEAD'), 'U-DEPARTMENT-HEAD');
  assert.equal(getApproverIdForStage(stages[2], threeLevelEmployee, 'U-COMPANY-HEAD'), 'U-COMPANY-HEAD');
  assert.equal(approvalRouteText(threeLevelEmployee), 'Direct Manager → Department Head → Company Head');
});

test('routes two-level employees from direct manager directly to company head', () => {
  const twoLevelEmployee = {
    managerSlackId: 'U-DIRECT-MANAGER',
    leaveApprovalRoute: '2-Level',
  };
  const stages = getLeaveApprovalStages(twoLevelEmployee, 'U-COMPANY-HEAD');
  assert.deepEqual(stages.map((stage) => stage.key), ['direct_manager_to_company_head', 'company_head']);
  assert.equal(stages[1].approvedStatus, 'Approved');
  assert.equal(getApproverIdForStage(stages[1], twoLevelEmployee, 'U-COMPANY-HEAD'), 'U-COMPANY-HEAD');
  assert.equal(approvalRouteText(twoLevelEmployee), 'Direct Manager → Company Head');
});

test('matches only the correct approver stage from the persisted request status', () => {
  const direct = getStageForLeaveRequest({ status: 'Pending' }, threeLevelEmployee, 'U-COMPANY-HEAD');
  const department = getStageForLeaveRequest({ status: 'Pending Department Head Approval' }, threeLevelEmployee, 'U-COMPANY-HEAD');
  const company = getStageForLeaveRequest({ status: 'Pending Company Head Approval' }, threeLevelEmployee, 'U-COMPANY-HEAD');
  assert.equal(direct.key, 'direct_manager');
  assert.equal(department.key, 'department_head');
  assert.equal(company.key, 'company_head');
  assert.equal(getStageForLeaveRequest({ status: 'Approved' }, threeLevelEmployee, 'U-COMPANY-HEAD'), null);
});

test('requires all configured approvers for a three-level route', () => {
  assert.throws(() => getLeaveApprovalStages({ leaveApprovalRoute: '3-Level', managerSlackId: 'U-MANAGER' }, 'U-COMPANY-HEAD'), /Department Head Slack ID/);
  assert.throws(() => getLeaveApprovalStages({ leaveApprovalRoute: '3-Level', managerSlackId: 'U-MANAGER', departmentHeadSlackId: 'U-DEPT' }, ''), /Company Head Slack ID/);
  assert.throws(() => getLeaveApprovalStages({ leaveApprovalRoute: '2-Level', managerSlackId: 'U-MANAGER' }, ''), /Company Head Slack ID/);
  assert.doesNotThrow(() => getLeaveApprovalStages({ leaveApprovalRoute: '2-Level', managerSlackId: 'U-MANAGER' }, 'U-COMPANY-HEAD'));
});

test('keeps earlier approval records visible in the next stage message', () => {
  const directApproval = approvalRecord({
    approverId: 'U-DIRECT-MANAGER',
    stageLabel: 'Direct Manager',
    approvedAt: '2026-10-19T12:00:00.000Z',
  });
  const history = approvalTrailText({ directManagerApproval: directApproval });
  assert.match(history, /Direct Manager/);
  assert.match(history, /U-DIRECT-MANAGER/);
});
