const THREE_LEVEL_ROUTE_VALUES = new Set([
  '3-LEVEL',
  '3 LEVEL',
  '3LEVEL',
  'THREE LEVEL',
  'THREE-LEVEL',
  'THREE LEVELS',
]);

const TWO_LEVEL_ROUTE_VALUES = new Set([
  '2-LEVEL',
  '2 LEVEL',
  '2LEVEL',
  'TWO LEVEL',
  'TWO-LEVEL',
  'TWO LEVELS',
]);

const APPROVAL_STAGES = {
  direct_manager: {
    key: 'direct_manager',
    label: 'Direct Manager',
    actionType: 'approval',
    pendingStatus: 'Pending',
    processingStatus: 'Direct Manager Approval Processing',
    completedStatus: 'Pending Department Head Approval',
    recordField: 'directManagerApproval',
  },
  direct_manager_to_final_acknowledgement: {
    key: 'direct_manager_to_final_acknowledgement',
    label: 'Direct Manager',
    actionType: 'approval',
    pendingStatus: 'Pending',
    processingStatus: 'Direct Manager Approval Processing',
    completedStatus: 'Pending Final Acknowledgement',
    recordField: 'directManagerApproval',
  },
  department_head: {
    key: 'department_head',
    label: 'Department Head',
    actionType: 'approval',
    pendingStatus: 'Pending Department Head Approval',
    processingStatus: 'Department Head Approval Processing',
    completedStatus: 'Pending Final Acknowledgement',
    recordField: 'departmentHeadApproval',
  },
  final_acknowledger: {
    key: 'final_acknowledger',
    label: 'Final Acknowledger',
    actionType: 'acknowledgement',
    pendingStatus: 'Pending Final Acknowledgement',
    processingStatus: 'Final Acknowledgement Processing',
    completedStatus: 'Approved',
    recordField: 'finalAcknowledgement',
  },
  final_manager: {
    key: 'final_manager',
    label: 'Manager',
    actionType: 'approval',
    pendingStatus: 'Pending',
    processingStatus: 'Approval Processing',
    completedStatus: 'Approved',
    recordField: 'directManagerApproval',
  },
};

function isThreeLevelLeaveRoute(employee = {}) {
  return THREE_LEVEL_ROUTE_VALUES.has(String(employee.leaveApprovalRoute || '').trim().toUpperCase());
}

function isTwoLevelLeaveRoute(employee = {}) {
  return TWO_LEVEL_ROUTE_VALUES.has(String(employee.leaveApprovalRoute || '').trim().toUpperCase());
}

function getLeaveApprovalStages(employee = {}, finalAcknowledgerSlackId = '') {
  const isThreeLevel = isThreeLevelLeaveRoute(employee);
  const isTwoLevel = isTwoLevelLeaveRoute(employee);

  if (!isThreeLevel && !isTwoLevel) return [APPROVAL_STAGES.final_manager];
  if (!employee.managerSlackId) throw new Error('This employee needs a Direct Manager Slack ID for the configured leave route.');
  if (!finalAcknowledgerSlackId) throw new Error('This employee needs a Final Acknowledger Slack ID for the configured leave route.');

  // In this route the Direct Manager is already the Department Head.
  if (isTwoLevel) {
    return [APPROVAL_STAGES.direct_manager_to_final_acknowledgement, APPROVAL_STAGES.final_acknowledger];
  }

  if (!employee.departmentHeadSlackId) throw new Error('This employee needs a Department Head Slack ID for the three-level leave route.');
  return [APPROVAL_STAGES.direct_manager, APPROVAL_STAGES.department_head, APPROVAL_STAGES.final_acknowledger];
}

function getStageForLeaveRequest(request = {}, employee = {}, finalAcknowledgerSlackId = '') {
  const stages = getLeaveApprovalStages(employee, finalAcknowledgerSlackId);
  return stages.find((stage) => stage.pendingStatus === request.status) || null;
}

function getApproverIdForStage(stage, employee = {}, finalAcknowledgerSlackId = '') {
  if (!stage) return '';
  if (stage.key === 'department_head') return employee.departmentHeadSlackId || '';
  if (stage.key === 'final_acknowledger') return finalAcknowledgerSlackId || '';
  return employee.managerSlackId || '';
}

function approvalRouteText(employee = {}) {
  return isThreeLevelLeaveRoute(employee)
    ? 'Direct Manager approval → Department Head approval → Final acknowledgement'
    : isTwoLevelLeaveRoute(employee)
    ? 'Direct Manager approval → Final acknowledgement'
    : 'Manager approval';
}

function stageRecord({ actorId, actorName = '', stageLabel, actionType = 'approval', completedAt = new Date().toISOString() }) {
  const displayName = actorName || (actorId ? `<@${actorId}>` : 'Unknown person');
  const action = actionType === 'acknowledgement' ? 'Acknowledged' : 'Approved';
  return `${action} — ${stageLabel}: ${displayName} — ${completedAt}`;
}

function approvalTrail(request = {}) {
  return [
    { label: 'Direct Manager Approval', value: request.directManagerApproval || '' },
    { label: 'Department Head Approval', value: request.departmentHeadApproval || '' },
    { label: 'Final Acknowledgement', value: request.finalAcknowledgement || '' },
  ].filter((item) => item.value);
}

function approvalTrailText(request = {}) {
  const trail = approvalTrail(request);
  return trail.length
    ? trail.map((item) => `✅ *${item.label}:* ${item.value}`).join('\n')
    : 'No earlier approvals recorded.';
}

function stageMessageTitle(stage, employee = {}) {
  if (!stage) return 'Leave Update';
  if (stage.actionType === 'acknowledgement') {
    const order = isThreeLevelLeaveRoute(employee) ? '3 of 3' : '2 of 2';
    return `Leave Acknowledgement Required — Level ${order}`;
  }
  if (isThreeLevelLeaveRoute(employee)) {
    const order = { direct_manager: '1 of 3', department_head: '2 of 3' }[stage.key] || '';
    return `Leave Approval Required — Level ${order}`;
  }
  if (isTwoLevelLeaveRoute(employee)) return 'Leave Approval Required — Level 1 of 2';
  return 'Leave Approval Required';
}

module.exports = {
  APPROVAL_STAGES,
  isThreeLevelLeaveRoute,
  isTwoLevelLeaveRoute,
  getLeaveApprovalStages,
  getStageForLeaveRequest,
  getApproverIdForStage,
  approvalRouteText,
  stageRecord,
  approvalTrail,
  approvalTrailText,
  stageMessageTitle,
};
