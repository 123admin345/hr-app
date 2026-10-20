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
    pendingStatus: 'Pending',
    processingStatus: 'Direct Manager Approval Processing',
    approvedStatus: 'Pending Department Head Approval',
    approvalField: 'directManagerApproval',
  },
  direct_manager_to_company_head: {
    key: 'direct_manager_to_company_head',
    label: 'Direct Manager',
    pendingStatus: 'Pending',
    processingStatus: 'Direct Manager Approval Processing',
    approvedStatus: 'Pending Company Head Approval',
    approvalField: 'directManagerApproval',
  },
  department_head: {
    key: 'department_head',
    label: 'Department Head',
    pendingStatus: 'Pending Department Head Approval',
    processingStatus: 'Department Head Approval Processing',
    approvedStatus: 'Pending Company Head Approval',
    approvalField: 'departmentHeadApproval',
  },
  company_head: {
    key: 'company_head',
    label: 'Company Head',
    pendingStatus: 'Pending Company Head Approval',
    processingStatus: 'Company Head Approval Processing',
    approvedStatus: 'Approved',
    approvalField: 'companyHeadApproval',
  },
  final_manager: {
    key: 'final_manager',
    label: 'Manager',
    pendingStatus: 'Pending',
    processingStatus: 'Approval Processing',
    approvedStatus: 'Approved',
    approvalField: 'directManagerApproval',
  },
};

function isThreeLevelLeaveRoute(employee = {}) {
  return THREE_LEVEL_ROUTE_VALUES.has(String(employee.leaveApprovalRoute || '').trim().toUpperCase());
}

function isTwoLevelLeaveRoute(employee = {}) {
  return TWO_LEVEL_ROUTE_VALUES.has(String(employee.leaveApprovalRoute || '').trim().toUpperCase());
}

function getLeaveApprovalStages(employee = {}, companyHeadSlackId = '') {
  const isThreeLevel = isThreeLevelLeaveRoute(employee);
  const isTwoLevel = isTwoLevelLeaveRoute(employee);

  if (!isThreeLevel && !isTwoLevel) return [APPROVAL_STAGES.final_manager];
  if (!employee.managerSlackId) throw new Error('This employee needs a Direct Manager Slack ID for the configured leave approval route.');

  // Two-level route: the direct manager is already the Department Head.
  // There is no separate Department Head stage; the request goes to Company Head next.
  if (isTwoLevel) {
    if (!companyHeadSlackId) throw new Error('This employee needs a Company Head Slack ID for the two-level leave approval route.');
    return [APPROVAL_STAGES.direct_manager_to_company_head, APPROVAL_STAGES.company_head];
  }

  if (!employee.departmentHeadSlackId) throw new Error('This employee needs a Department Head Slack ID for the three-level leave approval route.');
  if (!companyHeadSlackId) throw new Error('The Company Head Slack ID is not configured for the three-level leave approval route.');
  return [APPROVAL_STAGES.direct_manager, APPROVAL_STAGES.department_head, APPROVAL_STAGES.company_head];
}

function getStageForLeaveRequest(request = {}, employee = {}, companyHeadSlackId = '') {
  const stages = getLeaveApprovalStages(employee, companyHeadSlackId);
  return stages.find((stage) => stage.pendingStatus === request.status) || null;
}

function getApproverIdForStage(stage, employee = {}, companyHeadSlackId = '') {
  if (!stage) return '';
  if (stage.key === 'department_head') return employee.departmentHeadSlackId || '';
  if (stage.key === 'company_head') return companyHeadSlackId || '';
  return employee.managerSlackId || '';
}

function approvalRouteText(employee = {}) {
  return isThreeLevelLeaveRoute(employee)
    ? 'Direct Manager → Department Head → Company Head'
    : isTwoLevelLeaveRoute(employee)
    ? 'Direct Manager → Company Head'
    : 'Manager approval';
}

function approvalRecord({ approverId, approverName = '', stageLabel, approvedAt = new Date().toISOString() }) {
  const displayName = approverName || (approverId ? `<@${approverId}>` : 'Unknown approver');
  return `Approved — ${stageLabel}: ${displayName} — ${approvedAt}`;
}

function approvalTrail(request = {}) {
  return [
    { label: 'Direct Manager', value: request.directManagerApproval || '' },
    { label: 'Department Head', value: request.departmentHeadApproval || '' },
    { label: 'Company Head', value: request.companyHeadApproval || '' },
  ].filter((item) => item.value);
}

function approvalTrailText(request = {}) {
  const trail = approvalTrail(request);
  return trail.length
    ? trail.map((item) => `✅ *${item.label}:* ${item.value}`).join('\n')
    : 'No earlier approvals recorded.';
}

function stageMessageTitle(stage, employee = {}) {
  if (!stage) return 'Leave Approval';
  if (isThreeLevelLeaveRoute(employee)) {
    const order = { direct_manager: '1 of 3', department_head: '2 of 3', company_head: '3 of 3' }[stage.key] || '';
    return `Leave Approval Required — Level ${order}`;
  }
  if (isTwoLevelLeaveRoute(employee)) {
    const order = { direct_manager_to_company_head: '1 of 2', company_head: '2 of 2' }[stage.key] || '';
    return `Leave Approval Required — Level ${order}`;
  }
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
  approvalRecord,
  approvalTrail,
  approvalTrailText,
  stageMessageTitle,
};
