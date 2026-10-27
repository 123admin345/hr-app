const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getLeaveApprovalStages,
  getStageForLeaveRequest,
  getApproverIdForStage,
  approvalRouteText,
  stageRecord,
  approvalTrailText,
  stageMessageTitle,
} = require('../src/utils/leaveApprovalWorkflow');

const threeLevelEmployee = {
  name: 'Sample Employee',
  managerSlackId: 'U-DIRECT-MANAGER',
  departmentHeadSlackId: 'U-DEPARTMENT-HEAD',
  finalAcknowledgerSlackId: 'U-FINAL-ACKNOWLEDGER',
  leaveApprovalRoute: '3-Level',
};

test('uses the current one-manager leave route by default', () => {
  const stages = getLeaveApprovalStages({ managerSlackId: 'U-MANAGER' });
  assert.equal(stages.length, 1);
  assert.equal(stages[0].key, 'final_manager');
  assert.equal(stages[0].actionType, 'approval');
  assert.equal(stages[0].pendingStatus, 'Pending');
  assert.equal(stages[0].completedStatus, 'Approved');
});

test('routes configured employees through two approvals then final acknowledgement', () => {
  const stages = getLeaveApprovalStages(threeLevelEmployee, threeLevelEmployee.finalAcknowledgerSlackId);
  assert.deepEqual(stages.map((stage) => stage.key), ['direct_manager', 'department_head', 'final_acknowledger']);
  assert.deepEqual(stages.map((stage) => stage.pendingStatus), [
    'Pending',
    'Pending Department Head Approval',
    'Pending Final Acknowledgement',
  ]);
  assert.deepEqual(stages.map((stage) => stage.actionType), ['approval', 'approval', 'acknowledgement']);
  assert.equal(getApproverIdForStage(stages[0], threeLevelEmployee, threeLevelEmployee.finalAcknowledgerSlackId), 'U-DIRECT-MANAGER');
  assert.equal(getApproverIdForStage(stages[1], threeLevelEmployee, threeLevelEmployee.finalAcknowledgerSlackId), 'U-DEPARTMENT-HEAD');
  assert.equal(getApproverIdForStage(stages[2], threeLevelEmployee, threeLevelEmployee.finalAcknowledgerSlackId), 'U-FINAL-ACKNOWLEDGER');
  assert.equal(approvalRouteText(threeLevelEmployee), 'Direct Manager approval → Department Head approval → Final acknowledgement');
});

test('routes two-level employees from direct manager to final acknowledgement', () => {
  const twoLevelEmployee = {
    managerSlackId: 'U-DIRECT-MANAGER',
    finalAcknowledgerSlackId: 'U-FINAL-ACKNOWLEDGER',
    leaveApprovalRoute: '2-Level',
  };
  const stages = getLeaveApprovalStages(twoLevelEmployee, twoLevelEmployee.finalAcknowledgerSlackId);
  assert.deepEqual(stages.map((stage) => stage.key), ['direct_manager_to_final_acknowledgement', 'final_acknowledger']);
  assert.equal(stages[1].actionType, 'acknowledgement');
  assert.equal(stages[1].completedStatus, 'Approved');
  assert.equal(getApproverIdForStage(stages[1], twoLevelEmployee, twoLevelEmployee.finalAcknowledgerSlackId), 'U-FINAL-ACKNOWLEDGER');
  assert.equal(approvalRouteText(twoLevelEmployee), 'Direct Manager approval → Final acknowledgement');
  assert.match(stageMessageTitle(stages[1], twoLevelEmployee), /Acknowledgement Required/);
});

test('matches only the correct current stage from the persisted request status', () => {
  const direct = getStageForLeaveRequest({ status: 'Pending' }, threeLevelEmployee, threeLevelEmployee.finalAcknowledgerSlackId);
  const department = getStageForLeaveRequest({ status: 'Pending Department Head Approval' }, threeLevelEmployee, threeLevelEmployee.finalAcknowledgerSlackId);
  const acknowledgement = getStageForLeaveRequest({ status: 'Pending Final Acknowledgement' }, threeLevelEmployee, threeLevelEmployee.finalAcknowledgerSlackId);
  assert.equal(direct.key, 'direct_manager');
  assert.equal(department.key, 'department_head');
  assert.equal(acknowledgement.key, 'final_acknowledger');
  assert.equal(getStageForLeaveRequest({ status: 'Approved' }, threeLevelEmployee, threeLevelEmployee.finalAcknowledgerSlackId), null);
});

test('requires all configured route recipients', () => {
  assert.throws(() => getLeaveApprovalStages({ leaveApprovalRoute: '3-Level', managerSlackId: 'U-MANAGER', finalAcknowledgerSlackId: 'U-FINAL' }, 'U-FINAL'), /Department Head Slack ID/);
  assert.throws(() => getLeaveApprovalStages({ leaveApprovalRoute: '3-Level', managerSlackId: 'U-MANAGER', departmentHeadSlackId: 'U-DEPT' }, ''), /Final Acknowledger Slack ID/);
  assert.throws(() => getLeaveApprovalStages({ leaveApprovalRoute: '2-Level', managerSlackId: 'U-MANAGER' }, ''), /Final Acknowledger Slack ID/);
  assert.doesNotThrow(() => getLeaveApprovalStages({ leaveApprovalRoute: '2-Level', managerSlackId: 'U-MANAGER' }, 'U-FINAL'));
});

test('keeps earlier approvals and final acknowledgement visible in route history', () => {
  const directApproval = stageRecord({
    actorId: 'U-DIRECT-MANAGER',
    stageLabel: 'Direct Manager',
    actionType: 'approval',
    completedAt: '2026-10-20T12:00:00.000Z',
  });
  const finalAcknowledgement = stageRecord({
    actorId: 'U-FINAL-ACKNOWLEDGER',
    stageLabel: 'Final Acknowledger',
    actionType: 'acknowledgement',
    completedAt: '2026-10-20T12:05:00.000Z',
  });
  const history = approvalTrailText({ directManagerApproval: directApproval, finalAcknowledgement });
  assert.match(history, /Direct Manager Approval/);
  assert.match(history, /Final Acknowledgement/);
  assert.match(history, /Acknowledged/);
  assert.match(history, /U-FINAL-ACKNOWLEDGER/);
});
