/**
 * Builds the Block Kit modal for submitting a leave request.
 * The modal adapts based on leave type selection to show/hide the attachment section.
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
      {
        type: 'input',
        block_id: 'leave_type_block',
        element: {
          type: 'static_select',
          action_id: 'leave_type_select',
          placeholder: { type: 'plain_text', text: 'Select leave type' },
          options: [
            { text: { type: 'plain_text', text: '🏖️ Annual Leave' }, value: 'Annual' },
            { text: { type: 'plain_text', text: '🤒 Sick Leave' }, value: 'Sick' },
            { text: { type: 'plain_text', text: '🕌 Hajj Leave' }, value: 'Hajj' },
          ],
          initial_option: prefill.leaveType
            ? {
                text: { type: 'plain_text', text: prefill.leaveType },
                value: prefill.leaveType,
              }
            : undefined,
        },
        label: { type: 'plain_text', text: 'Leave Type', emoji: true },
      },
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
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📎 Attachments (Required for Sick & Hajj Leave)*\n\nIf you are requesting *Sick Leave*, please share your *Sehhaty (صحتي) app screenshot* and *hospital report* in the `#leave-attachments` channel and paste the Slack file links below.\n\nIf you are requesting *Hajj Leave*, please share your *government Hajj permission document* in the same channel.',
        },
      },
      {
        type: 'input',
        block_id: 'attachment_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'attachment_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Paste Slack file link(s) here (one per line). Required for Sick and Hajj leave.',
          },
        },
        label: { type: 'plain_text', text: 'Document Links', emoji: true },
      },
    ],
  };
}

module.exports = { buildLeaveRequestModal };
