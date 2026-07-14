/**
 * Builds the Block Kit modal for submitting a leave request.
 *
 * Flow:
 *  1. Employee fills the form (leave type, dates, notes) → clicks "Review Request"
 *  2. Modal updates to show a CONFIRMATION screen with total working days calculated
 *  3. Employee clicks "Confirm & Submit" to finalize
 *
 * Annual Leave  → submits directly to manager, no attachments needed.
 * Sick Leave    → after submission, bot DMs employee to upload documents privately.
 * Hajj Leave    → after submission, bot DMs employee to upload permission document privately.
 */

const { countWorkingDays, formatDate } = require('../utils/dates');

/**
 * Step 1 — The initial form the employee fills in.
 */
function buildLeaveRequestModal(prefill = {}) {
  return {
    type: 'modal',
    callback_id: 'leave_request_review',   // goes to review step first
    title: { type: 'plain_text', text: '🗓️ Request Leave', emoji: true },
    submit: { type: 'plain_text', text: 'Review Request →', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Please fill in the details below. You will see a summary with the total days before submitting.',
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
          initial_date: prefill.startDate || undefined,
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
          initial_date: prefill.endDate || undefined,
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
          initial_value: prefill.notes || undefined,
        },
        label: { type: 'plain_text', text: 'Notes', emoji: true },
      },
      { type: 'divider' },
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

/**
 * Step 2 — Confirmation screen showing the summary with total days.
 * The private_metadata carries all the data needed for final submission.
 */
function buildConfirmationModal({ leaveType, startDate, endDate, notes, totalDays, annualRemaining }) {
  const leaveEmoji = leaveType === 'Annual' ? '🏖️' : leaveType === 'Sick' ? '🤒' : '🕌';

  // Build a contextual note based on leave type
  let contextNote = '';
  if (leaveType === 'Annual') {
    const remainingAfter = annualRemaining - totalDays;
    contextNote = `After this request, you will have *${remainingAfter} day(s)* of annual leave remaining.`;
  } else if (leaveType === 'Sick') {
    contextNote = `📎 After confirming, the bot will send you a private DM asking you to upload your *Sehhaty (صحتي) screenshot* and *hospital report*.`;
  } else if (leaveType === 'Hajj') {
    contextNote = `📎 After confirming, the bot will send you a private DM asking you to upload your *official Hajj permission document*.`;
  }

  return {
    type: 'modal',
    callback_id: 'leave_request_submit',   // final submission
    title: { type: 'plain_text', text: '✅ Confirm Request', emoji: true },
    submit: { type: 'plain_text', text: 'Confirm + Submit', emoji: true },
    close: { type: 'plain_text', text: '← Go Back', emoji: true },
    private_metadata: JSON.stringify({ leaveType, startDate, endDate, notes }),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Please review your leave request before submitting:*`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Leave Type:*\n${leaveEmoji} ${leaveType} Leave` },
          { type: 'mrkdwn', text: `*Total Working Days:*\n📅 *${totalDays} day(s)*` },
          { type: 'mrkdwn', text: `*Start Date:*\n${formatDate(startDate)}` },
          { type: 'mrkdwn', text: `*End Date:*\n${formatDate(endDate)}` },
        ],
      },
      ...(notes ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Notes:*\n${notes}` },
      }] : []),
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: contextNote },
        ],
      },
    ],
  };
}

module.exports = { buildLeaveRequestModal, buildConfirmationModal };
