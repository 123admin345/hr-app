const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  newHireHrApproverIds,
  newHireFinanceApproverIds,
  isNewHireRequester,
  stageForNewHireRequest,
  nextStageFor,
  isAuthorisedForNewHireStage,
  approvalRecord,
  approvalHistoryText,
  validateNewHireRequestForm,
  newHireApprovalBlocks,
  newHireFinalStatusBlocks,
} = require('../src/utils/newHireRequest');
const {
  buildNewHireRequestModal,
  buildNewHireConfirmationModal,
  buildNewHireRejectionModal,
} = require('../src/modals/newHireRequestModal');

const baseRequest = {
  requestId: 'NEW-HIRE-TEST',
  requesterSlackId: 'U-REQUESTER',
  requesterName: 'Sample Manager',
  company: 'Sample Company',
  department: 'Commercial',
  jobTitle: 'Sales Executive',
  requestType: 'Replacement',
  employmentType: 'Full-time',
  proposedCandidateName: '',
  targetStartDate: '2026-12-01',
  businessJustification: 'Replace an approved commercial role with active client responsibility.',
  replacementEmployeeName: 'Former Employee',
  budgetSalaryRange: 'SAR 8,000–10,000 monthly',
  jobRequirements: 'Manage client relationships, pipeline, and new business opportunities.',
  businessApproverSlackId: 'U-BUSINESS',
  status: 'Pending HR Approval',
  hrApproval: '',
  financeApproval: '',
  businessApproval: '',
  rejectionReason: '',
};

test('authorises configured HR and Finance reviewers plus manager requesters', () => {
  const original = {
    NEW_HIRE_HR_APPROVER_IDS: process.env.NEW_HIRE_HR_APPROVER_IDS,
    NEW_HIRE_FINANCE_APPROVER_IDS: process.env.NEW_HIRE_FINANCE_APPROVER_IDS,
    HR_MANAGER_ID: process.env.HR_MANAGER_ID,
    FINANCE_MANAGER_ID: process.env.FINANCE_MANAGER_ID,
    ADMIN_SLACK_IDS: process.env.ADMIN_SLACK_IDS,
    NEW_HIRE_REQUESTER_IDS: process.env.NEW_HIRE_REQUESTER_IDS,
  };
  process.env.NEW_HIRE_HR_APPROVER_IDS = 'U-HR-ONE,U-HR-TWO';
  process.env.NEW_HIRE_FINANCE_APPROVER_IDS = 'U-FINANCE-ONE';
  process.env.HR_MANAGER_ID = 'U-HR-MANAGER';
  process.env.FINANCE_MANAGER_ID = 'U-FINANCE-MANAGER';
  process.env.ADMIN_SLACK_IDS = 'U-ADMIN';
  process.env.NEW_HIRE_REQUESTER_IDS = 'U-SPECIAL-REQUESTER';

  assert.deepEqual(newHireHrApproverIds(), ['U-HR-ONE', 'U-HR-TWO', 'U-HR-MANAGER', 'U-ADMIN']);
  assert.deepEqual(newHireFinanceApproverIds(), ['U-FINANCE-ONE', 'U-FINANCE-MANAGER']);
  assert.equal(isNewHireRequester({ isManager: true }, 'U-MANAGER'), true);
  assert.equal(isNewHireRequester({ isManager: false }, 'U-SPECIAL-REQUESTER'), true);
  assert.equal(isNewHireRequester({ isManager: false }, 'U-OTHER'), false);

  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('uses HR, Finance, then the request-specific business approver', () => {
  const original = {
    NEW_HIRE_HR_APPROVER_IDS: process.env.NEW_HIRE_HR_APPROVER_IDS,
    NEW_HIRE_FINANCE_APPROVER_IDS: process.env.NEW_HIRE_FINANCE_APPROVER_IDS,
    HR_MANAGER_ID: process.env.HR_MANAGER_ID,
    FINANCE_MANAGER_ID: process.env.FINANCE_MANAGER_ID,
    ADMIN_SLACK_IDS: process.env.ADMIN_SLACK_IDS,
  };
  process.env.NEW_HIRE_HR_APPROVER_IDS = 'U-HR';
  process.env.NEW_HIRE_FINANCE_APPROVER_IDS = 'U-FINANCE';
  process.env.HR_MANAGER_ID = '';
  process.env.FINANCE_MANAGER_ID = '';
  process.env.ADMIN_SLACK_IDS = '';

  const hrStage = stageForNewHireRequest(baseRequest);
  const financeStage = stageForNewHireRequest({ ...baseRequest, status: 'Pending Finance Approval' });
  const businessStage = stageForNewHireRequest({ ...baseRequest, status: 'Pending Business Approval' });
  assert.equal(hrStage.key, 'hr');
  assert.equal(nextStageFor(hrStage).key, 'finance');
  assert.equal(financeStage.key, 'finance');
  assert.equal(nextStageFor(financeStage).key, 'business');
  assert.equal(businessStage.key, 'business');
  assert.equal(nextStageFor(businessStage), null);
  assert.equal(isAuthorisedForNewHireStage('U-HR', hrStage, baseRequest), true);
  assert.equal(isAuthorisedForNewHireStage('U-FINANCE', financeStage, baseRequest), true);
  assert.equal(isAuthorisedForNewHireStage('U-BUSINESS', businessStage, baseRequest), true);
  assert.equal(isAuthorisedForNewHireStage('U-OTHER', businessStage, baseRequest), false);

  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('requires the essential new-hire request information before review', () => {
  const errors = validateNewHireRequestForm({}, '2026-10-26');
  assert.match(errors.company_block, /company/i);
  assert.match(errors.department_block, /department/i);
  assert.match(errors.job_title_block, /job title/i);
  assert.match(errors.request_type_block, /request type/i);
  assert.match(errors.employment_type_block, /employment type/i);
  assert.match(errors.business_justification_block, /business need/i);
  assert.match(errors.budget_range_block, /salary range/i);
  assert.match(errors.job_requirements_block, /job description/i);
  assert.match(validateNewHireRequestForm({ ...baseRequest, targetStartDate: '2026-10-25' }, '2026-10-26').target_start_block, /past/i);
  assert.deepEqual(validateNewHireRequestForm(baseRequest, '2026-10-26'), {});
});

test('builds confidential approval blocks with request-ID-only decision buttons', () => {
  const blocks = newHireApprovalBlocks(baseRequest);
  const actionBlock = blocks.find((block) => block.type === 'actions');
  assert.equal(actionBlock.elements.length, 2);
  assert.deepEqual(JSON.parse(actionBlock.elements[0].value), { requestId: 'NEW-HIRE-TEST' });
  assert.equal(actionBlock.elements[0].action_id, 'new_hire_approve');
  assert.equal(actionBlock.elements[1].action_id, 'new_hire_reject');
  assert.match(JSON.stringify(blocks), /Business justification/);
  assert.match(JSON.stringify(blocks), /key requirements/);
});

test('replaces completed or processing request messages with no decision buttons', () => {
  const finalBlocks = newHireFinalStatusBlocks({
    ...baseRequest,
    status: 'Approved — Recruitment May Begin',
    hrApproval: approvalRecord({ actorId: 'U-HR', stageLabel: 'HR', decision: 'Approved', at: '2026-10-26T09:00:00.000Z' }),
    financeApproval: approvalRecord({ actorId: 'U-FINANCE', stageLabel: 'Finance', decision: 'Approved', at: '2026-10-26T09:05:00.000Z' }),
    businessApproval: approvalRecord({ actorId: 'U-BUSINESS', stageLabel: 'Business Approver', decision: 'Approved', at: '2026-10-26T09:10:00.000Z' }),
  });
  assert.equal(finalBlocks.some((block) => block.type === 'actions'), false);
  assert.match(finalBlocks[0].text.text, /Recruitment May Begin/);
  assert.match(finalBlocks[0].text.text, /No candidate offer is approved/);
  assert.match(approvalHistoryText({
    hrApproval: 'Approved — HR',
    financeApproval: 'Approved — Finance',
    businessApproval: 'Approved — Business',
  }), /Finance/);
});

test('keeps all new-hire modal titles within Slack limits and preserves form data in confirmation', () => {
  const initial = buildNewHireRequestModal();
  const confirmation = buildNewHireConfirmationModal(baseRequest);
  const rejection = buildNewHireRejectionModal({ requestId: 'NEW-HIRE-TEST', channel: 'C-HR', ts: '1.23', stageLabel: 'HR' });
  [initial, confirmation, rejection].forEach((view) => {
    assert.ok(view.title.text.length <= 24, `${view.title.text} is too long for a Slack modal title`);
  });
  assert.equal(JSON.parse(confirmation.private_metadata).company, 'Sample Company');
  assert.equal(JSON.parse(rejection.private_metadata).requestId, 'NEW-HIRE-TEST');
});

test('uses atomic Sheet status claims and current-stage authorisation before decisions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'newHireHandler.js'), 'utf8');
  const sheetsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'sheets.js'), 'utf8');
  assert.match(source, /claimNewHireRequestDecision\(requestId, stage\.processingStatus, stage\.pendingStatus\)/);
  assert.match(source, /isAuthorisedForNewHireStage\(actorId, stage, current\)/);
  assert.match(source, /businessApproverSlackId = await getCompanyBusinessApprover\(data\.company\)/);
  assert.match(source, /A decision message must never regain action buttons/);
  assert.match(sheetsSource, /startColumnIndex: 14, \/\/ O: Status/);
  assert.match(sheetsSource, /'Business Approver Slack ID'/);
  assert.match(sheetsSource, /'Business Justification'/);
});
