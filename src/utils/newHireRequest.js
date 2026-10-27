const { formatDate, saudiTodayDateString } = require('./dates');

function parseSlackIds(value = '') {
  return String(value)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function newHireHrApproverIds() {
  return [...new Set([
    ...parseSlackIds(process.env.NEW_HIRE_HR_APPROVER_IDS),
    ...parseSlackIds(process.env.HR_MANAGER_ID),
    ...parseSlackIds(process.env.ADMIN_SLACK_IDS),
  ])];
}

function newHireFinanceApproverIds() {
  return [...new Set([
    ...parseSlackIds(process.env.NEW_HIRE_FINANCE_APPROVER_IDS),
    ...parseSlackIds(process.env.FINANCE_MANAGER_ID),
  ])];
}

function newHireRequesterIds() {
  return parseSlackIds(process.env.NEW_HIRE_REQUESTER_IDS);
}

function isNewHireHrUser(slackUserId) {
  return newHireHrApproverIds().includes(slackUserId);
}

function isNewHireFinanceUser(slackUserId) {
  return newHireFinanceApproverIds().includes(slackUserId);
}

function isNewHireRequester(employee, slackUserId) {
  return Boolean(employee?.isManager || newHireRequesterIds().includes(slackUserId));
}

const STAGES = [
  {
    key: 'hr',
    pendingStatus: 'Pending HR Approval',
    processingStatus: 'HR Approval Processing',
    approvedStatus: 'Pending Finance Approval',
    rejectedStatus: 'Rejected by HR',
    recordField: 'hrApproval',
    label: 'HR',
  },
  {
    key: 'finance',
    pendingStatus: 'Pending Finance Approval',
    processingStatus: 'Finance Approval Processing',
    approvedStatus: 'Pending Business Approval',
    rejectedStatus: 'Rejected by Finance',
    recordField: 'financeApproval',
    label: 'Finance',
  },
  {
    key: 'business',
    pendingStatus: 'Pending Business Approval',
    processingStatus: 'Business Approval Processing',
    approvedStatus: 'Approved — Recruitment May Begin',
    rejectedStatus: 'Rejected by Business',
    recordField: 'businessApproval',
    label: 'Business Approver',
  },
];

function stageForNewHireRequest(request = {}) {
  return STAGES.find((stage) => stage.pendingStatus === request.status) || null;
}

function nextStageFor(stage) {
  const currentIndex = STAGES.findIndex((item) => item.key === stage?.key);
  return currentIndex === -1 ? null : STAGES[currentIndex + 1] || null;
}

function isAuthorisedForNewHireStage(slackUserId, stage, request = {}) {
  if (!stage) return false;
  if (stage.key === 'hr') return isNewHireHrUser(slackUserId);
  if (stage.key === 'finance') return isNewHireFinanceUser(slackUserId);
  return Boolean(request.businessApproverSlackId && request.businessApproverSlackId === slackUserId);
}

function approvalRecord({ actorId, stageLabel, decision, reason = '', at = new Date().toISOString() }) {
  return `${decision} — ${stageLabel}: ${actorId} — ${at}${reason ? ` — ${reason}` : ''}`;
}

function approvalHistoryText(request = {}) {
  const records = [
    { label: 'HR', value: request.hrApproval },
    { label: 'Finance', value: request.financeApproval },
    { label: 'Business', value: request.businessApproval },
  ].filter((item) => item.value);

  return records.length
    ? records.map((item) => `• *${item.label}:* ${item.value}`).join('\n')
    : 'No completed decisions yet.';
}

function validateNewHireRequestForm(data = {}, today = saudiTodayDateString()) {
  const errors = {};
  if (!String(data.company || '').trim()) errors.company_block = 'Please enter the employing company.';
  if (!String(data.department || '').trim()) errors.department_block = 'Please enter the department.';
  if (!String(data.jobTitle || '').trim()) errors.job_title_block = 'Please enter the requested job title.';
  if (!data.requestType) errors.request_type_block = 'Please choose the hiring request type.';
  if (!data.employmentType) errors.employment_type_block = 'Please choose the employment type.';
  if (data.targetStartDate && data.targetStartDate < today) {
    errors.target_start_block = 'The target start date cannot be in the past.';
  }
  if (!String(data.businessJustification || '').trim()) {
    errors.business_justification_block = 'Please explain the business need for this hire.';
  }
  if (!String(data.budgetSalaryRange || '').trim()) {
    errors.budget_range_block = 'Please enter the approved or requested monthly salary range / budget.';
  }
  if (!String(data.jobRequirements || '').trim()) {
    errors.job_requirements_block = 'Please provide the job description or key requirements.';
  }
  return errors;
}

function truncate(text, limit = 2600) {
  const value = String(text || '').trim();
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function requestFields(request) {
  return [
    { type: 'mrkdwn', text: `*Company:*\n${request.company}` },
    { type: 'mrkdwn', text: `*Department:*\n${request.department}` },
    { type: 'mrkdwn', text: `*Job title:*\n${request.jobTitle}` },
    { type: 'mrkdwn', text: `*Request type:*\n${request.requestType}` },
    { type: 'mrkdwn', text: `*Employment type:*\n${request.employmentType}` },
    { type: 'mrkdwn', text: `*Target start:*\n${request.targetStartDate ? formatDate(request.targetStartDate) : 'Not specified'}` },
    { type: 'mrkdwn', text: `*Proposed person:*\n${request.proposedCandidateName || 'To be recruited'}` },
    { type: 'mrkdwn', text: `*Budget / monthly salary range:*\n${request.budgetSalaryRange}` },
  ];
}

function newHireApprovalBlocks(request) {
  const stage = stageForNewHireRequest(request);
  if (!stage) return newHireFinalStatusBlocks(request);
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: `New Hire — ${stage.label} Review`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Requested by:* <@${request.requesterSlackId}> (${request.requesterName})\n*Request ID:* ${request.requestId}\n*Your action:* Review this confidential hiring request and approve it, or reject it with a reason.`,
      },
    },
    { type: 'divider' },
    { type: 'section', fields: requestFields(request) },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Business justification:*\n${truncate(request.businessJustification)}` },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Job description / key requirements:*\n${truncate(request.jobRequirements)}` },
    },
    ...(request.hrApproval || request.financeApproval || request.businessApproval ? [{
      type: 'section',
      text: { type: 'mrkdwn', text: `*Decision history:*\n${approvalHistoryText(request)}` },
    }] : []),
    { type: 'divider' },
    {
      type: 'actions',
      block_id: 'new_hire_decision_actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve', emoji: true },
          style: 'primary',
          action_id: 'new_hire_approve',
          value: JSON.stringify({ requestId: request.requestId }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Reject', emoji: true },
          style: 'danger',
          action_id: 'new_hire_reject',
          value: JSON.stringify({ requestId: request.requestId }),
        },
      ],
    },
  ];
}

function newHireFinalStatusBlocks(request) {
  const processing = /Processing$/.test(request.status || '');
  const approved = request.status === 'Approved — Recruitment May Begin';
  const rejected = String(request.status || '').startsWith('Rejected by');
  const icon = processing ? '⏳' : approved ? '✅' : rejected ? '❌' : 'ℹ️';
  const title = processing
    ? 'New Hire Decision Processing'
    : approved
      ? 'New Hire Request Approved'
      : rejected
        ? 'New Hire Request Rejected'
        : 'New Hire Request Updated';
  const message = processing
    ? 'This action is being processed. The action buttons have been removed to prevent a duplicate decision.'
    : approved
      ? 'All required approvals are complete. HR may now begin recruitment for this approved role. No candidate offer is approved at this stage.'
      : rejected
        ? 'This hiring request has been rejected. The requester has been notified privately with the reason.'
        : `This request is now marked as ${request.status}.`;

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${title}*\n\n*Request ID:* ${request.requestId}\n*Company:* ${request.company}\n*Department:* ${request.department}\n*Job title:* ${request.jobTitle}\n*Status:* ${request.status}\n\n*Decision history:*\n${approvalHistoryText(request)}${request.rejectionReason ? `\n\n*Reason:*\n> ${request.rejectionReason}` : ''}\n\n${message}`,
      },
    },
  ];
}

function requesterStatusText(request) {
  if (request.status === 'Approved — Recruitment May Begin') {
    return `✅ *Your new-hire request has been approved.*\n\n*Role:* ${request.jobTitle}\n*Company:* ${request.company}\n*Department:* ${request.department}\n\nHR may now begin recruitment. This approval authorises the vacancy only; a candidate offer will need its own later approval.`;
  }
  return `❌ *Your new-hire request was not approved.*\n\n*Role:* ${request.jobTitle}\n*Company:* ${request.company}\n*Stage:* ${request.status.replace('Rejected by ', '')}\n*Reason:*\n> ${request.rejectionReason || 'No reason provided.'}\n\nPlease contact HR if you need to discuss or revise the request.`;
}

module.exports = {
  parseSlackIds,
  newHireHrApproverIds,
  newHireFinanceApproverIds,
  isNewHireHrUser,
  isNewHireFinanceUser,
  isNewHireRequester,
  STAGES,
  stageForNewHireRequest,
  nextStageFor,
  isAuthorisedForNewHireStage,
  approvalRecord,
  approvalHistoryText,
  validateNewHireRequestForm,
  newHireApprovalBlocks,
  newHireFinalStatusBlocks,
  requesterStatusText,
};
