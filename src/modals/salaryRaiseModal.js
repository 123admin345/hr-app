/**
 * Modals for the Salary Raise Request workflow.
 *
 * Flow:
 *  1. Manager types /request-raise → fills employee name, current salary, new salary
 *  2. App calculates difference → shows confirmation screen with summary
 *  3. Manager confirms → request goes to owner (Dr. Mohammed Zamakhshary)
 *  4. Owner approves → app calculates effective month, notifies manager + HR + Finance
 *  5. Owner rejects → rejection reason modal opens → reason sent back to manager
 */

/**
 * Step 1 — The form the manager fills in.
 */
function buildSalaryRaiseFormModal(prefill = {}) {
  return {
    type: 'modal',
    callback_id: 'salary_raise_review',
    title: { type: 'plain_text', text: '💰 Request Salary Raise', emoji: true },
    submit: { type: 'plain_text', text: 'Review Request →', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Fill in the details below. You will see a summary before the request is sent to Dr. Mohammed for approval.',
        },
      },
      { type: 'divider' },
      // ── Employee Name ───────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'employee_name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'employee_name_input',
          placeholder: { type: 'plain_text', text: 'e.g. Sara Ahmed' },
          initial_value: prefill.employeeName || undefined,
        },
        label: { type: 'plain_text', text: 'Employee Full Name', emoji: true },
      },
      // ── Employee Slack User (optional mention) ──────────────────────────────
      {
        type: 'input',
        block_id: 'employee_user_block',
        optional: true,
        element: {
          type: 'users_select',
          action_id: 'employee_user_select',
          placeholder: { type: 'plain_text', text: 'Select employee from workspace' },
        },
        label: { type: 'plain_text', text: 'Employee (Slack)', emoji: true },
      },
      // ── Current Salary ──────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'current_salary_block',
        element: {
          type: 'plain_text_input',
          action_id: 'current_salary_input',
          placeholder: { type: 'plain_text', text: 'e.g. 8000' },
          initial_value: prefill.currentSalary || undefined,
        },
        label: { type: 'plain_text', text: 'Current Salary (SAR)', emoji: true },
        hint: { type: 'plain_text', text: 'Enter numbers only, no commas or currency symbols.' },
      },
      // ── New Salary ──────────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'new_salary_block',
        element: {
          type: 'plain_text_input',
          action_id: 'new_salary_input',
          placeholder: { type: 'plain_text', text: 'e.g. 9500' },
          initial_value: prefill.newSalary || undefined,
        },
        label: { type: 'plain_text', text: 'New Salary (SAR)', emoji: true },
        hint: { type: 'plain_text', text: 'Enter numbers only, no commas or currency symbols.' },
      },
      // ── Reason ──────────────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'raise_reason_block',
        element: {
          type: 'plain_text_input',
          action_id: 'raise_reason_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Explain the reason for this raise request...' },
          initial_value: prefill.reason || undefined,
        },
        label: { type: 'plain_text', text: 'Reason for Raise', emoji: true },
      },
    ],
  };
}

/**
 * Step 2 — Confirmation screen showing the full summary with calculated difference.
 */
function buildSalaryRaiseConfirmModal({ employeeName, employeeSlackId, currentSalary, newSalary, reason, difference, percentageIncrease, effectiveMonth }) {
  const formattedCurrent = Number(currentSalary).toLocaleString('en-SA');
  const formattedNew     = Number(newSalary).toLocaleString('en-SA');
  const formattedDiff    = Number(difference).toLocaleString('en-SA');

  return {
    type: 'modal',
    callback_id: 'salary_raise_submit',
    title: { type: 'plain_text', text: '✅ Confirm Raise Request', emoji: true },
    submit: { type: 'plain_text', text: 'Send to Dr. Mohammed', emoji: true },
    close: { type: 'plain_text', text: '← Go Back', emoji: true },
    private_metadata: JSON.stringify({ employeeName, employeeSlackId, currentSalary, newSalary, difference, percentageIncrease, reason, effectiveMonth }),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Please review the raise request before sending to Dr. Mohammed for approval:*' },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Employee:*\n${employeeName}${employeeSlackId ? ` (<@${employeeSlackId}>)` : ''}` },
          { type: 'mrkdwn', text: `*Effective Month:*\n📅 ${effectiveMonth}` },
          { type: 'mrkdwn', text: `*Current Salary:*\nSAR ${formattedCurrent}` },
          { type: 'mrkdwn', text: `*New Salary:*\nSAR ${formattedNew}` },
          { type: 'mrkdwn', text: `*Increase Amount:*\n💰 *SAR ${formattedDiff}*` },
          { type: 'mrkdwn', text: `*Increase Percentage:*\n📈 *${percentageIncrease}%*` },
        ],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Reason:*\n${reason}` },
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: '📨 Once you click *Send to Dr. Mohammed*, this request will go directly to him for approval. You will be notified of his decision.' },
        ],
      },
    ],
  };
}

/**
 * Rejection reason modal — opened when owner clicks Reject.
 */
function buildRaiseRejectModal(raiseDataJson, employeeName) {
  return {
    type: 'modal',
    callback_id: 'salary_raise_reject_submit',
    title: { type: 'plain_text', text: '❌ Reject Raise Request', emoji: true },
    submit: { type: 'plain_text', text: 'Send Feedback', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    private_metadata: raiseDataJson,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `You are rejecting the salary raise request for *${employeeName}*. Please provide your reason or feedback below — it will be sent directly to the requesting manager.`,
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'reject_reason_block',
        element: {
          type: 'plain_text_input',
          action_id: 'reject_reason_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'e.g. Let\'s discuss this further. The current performance review cycle ends next month...' },
        },
        label: { type: 'plain_text', text: 'Reason / Feedback', emoji: true },
      },
    ],
  };
}

module.exports = { buildSalaryRaiseFormModal, buildSalaryRaiseConfirmModal, buildRaiseRejectModal };
