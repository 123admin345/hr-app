const { formatDate } = require('../utils/dates');

function buildNewHireRequestModal() {
  return {
    type: 'modal',
    callback_id: 'new_hire_request_review',
    title: { type: 'plain_text', text: 'New Hire Request', emoji: true },
    submit: { type: 'plain_text', text: 'Review Request', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Use this confidential form to request approval to open a vacancy or hire a proposed person. Recruitment must not start until HR, Finance, and the assigned business approver complete their reviews.',
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'company_block',
        element: {
          type: 'plain_text_input',
          action_id: 'company_input',
          placeholder: { type: 'plain_text', text: 'Employing company name' },
        },
        label: { type: 'plain_text', text: 'Company', emoji: true },
      },
      {
        type: 'input',
        block_id: 'department_block',
        element: {
          type: 'plain_text_input',
          action_id: 'department_input',
          placeholder: { type: 'plain_text', text: 'Department / business area' },
        },
        label: { type: 'plain_text', text: 'Department', emoji: true },
      },
      {
        type: 'input',
        block_id: 'job_title_block',
        element: {
          type: 'plain_text_input',
          action_id: 'job_title_input',
          placeholder: { type: 'plain_text', text: 'Official requested job title' },
        },
        label: { type: 'plain_text', text: 'Job title', emoji: true },
      },
      {
        type: 'input',
        block_id: 'request_type_block',
        element: {
          type: 'static_select',
          action_id: 'request_type_select',
          placeholder: { type: 'plain_text', text: 'Select request type' },
          options: [
            { text: { type: 'plain_text', text: 'Replacement hire' }, value: 'Replacement' },
            { text: { type: 'plain_text', text: 'New headcount / new role' }, value: 'New Headcount' },
            { text: { type: 'plain_text', text: 'Temporary cover' }, value: 'Temporary Cover' },
            { text: { type: 'plain_text', text: 'Internship' }, value: 'Internship' },
            { text: { type: 'plain_text', text: 'Consultant / contractor' }, value: 'Consultant / Contractor' },
          ],
        },
        label: { type: 'plain_text', text: 'Request type', emoji: true },
      },
      {
        type: 'input',
        block_id: 'employment_type_block',
        element: {
          type: 'static_select',
          action_id: 'employment_type_select',
          placeholder: { type: 'plain_text', text: 'Select employment type' },
          options: [
            { text: { type: 'plain_text', text: 'Full-time' }, value: 'Full-time' },
            { text: { type: 'plain_text', text: 'Fixed-term' }, value: 'Fixed-term' },
            { text: { type: 'plain_text', text: 'Part-time' }, value: 'Part-time' },
            { text: { type: 'plain_text', text: 'Internship' }, value: 'Internship' },
            { text: { type: 'plain_text', text: 'Consultant / contractor' }, value: 'Consultant / Contractor' },
          ],
        },
        label: { type: 'plain_text', text: 'Employment type', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'candidate_name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'candidate_name_input',
          placeholder: { type: 'plain_text', text: 'Leave blank if recruitment has not started' },
        },
        label: { type: 'plain_text', text: 'Proposed person, if known', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'target_start_block',
        element: {
          type: 'datepicker',
          action_id: 'target_start_pick',
          placeholder: { type: 'plain_text', text: 'Select a target start date' },
        },
        label: { type: 'plain_text', text: 'Target start date', emoji: true },
      },
      {
        type: 'input',
        block_id: 'business_justification_block',
        element: {
          type: 'plain_text_input',
          action_id: 'business_justification_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Explain the business need and impact of not hiring' },
        },
        label: { type: 'plain_text', text: 'Business justification', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'replacement_employee_block',
        element: {
          type: 'plain_text_input',
          action_id: 'replacement_employee_input',
          placeholder: { type: 'plain_text', text: 'Required for a replacement hire, if known' },
        },
        label: { type: 'plain_text', text: 'Employee being replaced', emoji: true },
      },
      {
        type: 'input',
        block_id: 'budget_range_block',
        element: {
          type: 'plain_text_input',
          action_id: 'budget_range_input',
          placeholder: { type: 'plain_text', text: 'Example: SAR 8,000–10,000 monthly' },
        },
        label: { type: 'plain_text', text: 'Budget / monthly salary range', emoji: true },
      },
      {
        type: 'input',
        block_id: 'job_requirements_block',
        element: {
          type: 'plain_text_input',
          action_id: 'job_requirements_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Role purpose, key duties, and must-have requirements' },
        },
        label: { type: 'plain_text', text: 'Job description / key requirements', emoji: true },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'This request creates permission to recruit only. It does not approve an offer, contract, or final salary for a candidate.',
          },
        ],
      },
    ],
  };
}

function buildNewHireConfirmationModal(data) {
  return {
    type: 'modal',
    callback_id: 'new_hire_request_submit',
    title: { type: 'plain_text', text: 'Confirm New Hire', emoji: true },
    submit: { type: 'plain_text', text: 'Send for HR Review', emoji: true },
    close: { type: 'plain_text', text: 'Go Back', emoji: true },
    private_metadata: JSON.stringify(data),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Please review your confidential new-hire request before sending it to HR.*' },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Company:*\n${data.company}` },
          { type: 'mrkdwn', text: `*Department:*\n${data.department}` },
          { type: 'mrkdwn', text: `*Job title:*\n${data.jobTitle}` },
          { type: 'mrkdwn', text: `*Request type:*\n${data.requestType}` },
          { type: 'mrkdwn', text: `*Employment type:*\n${data.employmentType}` },
          { type: 'mrkdwn', text: `*Target start:*\n${data.targetStartDate ? formatDate(data.targetStartDate) : 'Not specified'}` },
          { type: 'mrkdwn', text: `*Proposed person:*\n${data.proposedCandidateName || 'To be recruited'}` },
          { type: 'mrkdwn', text: `*Budget / monthly salary range:*\n${data.budgetSalaryRange}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Business justification:*\n${data.businessJustification}` },
      },
      ...(data.replacementEmployeeName ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Employee being replaced:*\n${data.replacementEmployeeName}` },
      }] : []),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Job description / key requirements:*\n${data.jobRequirements}` },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'After you submit, HR will review it first. Finance and the assigned business approver will review only after HR approves.',
          },
        ],
      },
    ],
  };
}

function buildNewHireRejectionModal({ requestId, channel, ts, stageLabel }) {
  return {
    type: 'modal',
    callback_id: 'new_hire_rejection_submit',
    title: { type: 'plain_text', text: 'Reject Hire Request', emoji: true },
    submit: { type: 'plain_text', text: 'Reject Request', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    private_metadata: JSON.stringify({ requestId, channel, ts, stageLabel }),
    blocks: [
      {
        type: 'input',
        block_id: 'new_hire_rejection_reason_block',
        element: {
          type: 'plain_text_input',
          action_id: 'new_hire_rejection_reason_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Explain what must change or why this request cannot proceed' },
        },
        label: { type: 'plain_text', text: 'Reason for rejection', emoji: true },
      },
    ],
  };
}

module.exports = {
  buildNewHireRequestModal,
  buildNewHireConfirmationModal,
  buildNewHireRejectionModal,
};
