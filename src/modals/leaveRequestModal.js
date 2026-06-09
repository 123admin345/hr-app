/**
 * Builds the Block Kit modal for submitting a leave request.
 *
 * Annual Leave  → submits directly to manager, no attachments needed.
 * Sick Leave    → after submission, bot DMs employee to upload documents privately.
 * Hajj Leave    → after submission, bot DMs employee to upload permission document privately.
 */

function buildLeaveRequestModal(prefill = {}) {
  return {
    type: 'modal',
    callback_id: 'leave_request_submit',
    title: { type: 'plain_text', text: '🗓️ Request Leave', emoji: true },
    submit: { type: 'plain_text', text: 'Submit Request', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Please fill in the details below. Your manager will be notified to approve or reject your request.',
        },
      },
      { type: 'divider' },
      // ── Leave Type ──────────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'leave_type_block',
        element: {
          type: 'static_select',
          action_id: 'leave_type_select',
          placeholder: { type: 'plain_text', text: 'Select leave type' },
          options: [
            { text: { type: 'plain_text', text: '🏖️ Annual Leave', emoji: true }, value: 'Annual' },
            { text: { type: 'plain_text', text: '🤒 Sick Leave', emoji: true }, value: 'Sick' },
            { text: { type: 'plain_text', text: '🕌 Hajj Leave', emoji: true }, value: 'Hajj' },
          ],
          initial_option: prefill.leaveType
            ? { text: { type: 'plain_text', text: prefill.leaveType }, value: prefill.leaveType }
            : undefined,
        },
        label: { type: 'plain_text', text: 'Leave Type', emoji: true },
      },
      // ── Start Date ──────────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'start_date_block',
        element: {
          type: 'datepicker',
          action_id: 'start_date_pick',
          placeholder: { type: 'plain_text', text: 'Select start date' },
        },
        label: { type: 'plain_text', text: 'Start Date', emoji: true },
      },
      // ── End Date ────────────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'end_date_block',
        element: {
          type: 'datepicker',
          action_id: 'end_date_pick',
          placeholder: { type: 'plain_text', text: 'Select end date' },
        },
        label: { type: 'plain_text', text: 'End Date', emoji: true },
      },
      // ── Notes (optional) ────────────────────────────────────────────────────
      {
        type: 'input',
        block_id: 'notes_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'notes_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Any additional notes (optional)' },
        },
        label: { type: 'plain_text', text: 'Notes', emoji: true },
      },
      { type: 'divider' },
      // ── Attachment hint (informational only, no input field) ────────────────
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '📎 *Sick or Hajj Leave?* After you submit, the bot will send you a private message asking you to upload your documents directly there. No public channels involved.',
          },
        ],
      },
    ],
  };
}

module.exports = { buildLeaveRequestModal };
