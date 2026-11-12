/**
 * Builds the Block Kit modal for submitting a leave request.
 *
 * Flow:
 *  1. Employee fills the form → clicks "Review Request"
 *  2. Modal updates to show a confirmation screen with the calculated duration
 *  3. Employee clicks "Confirm & Submit" to finalize
 *
 * Annual Leave  → submits directly to manager, no attachments needed.
 * Sick Leave    → after submission, bot DMs employee to upload documents privately.
 * Hajj Leave    → after submission, bot DMs employee to upload permission document privately.
 * Maternity     → actual delivery date starts three calendar months; proof is sent
 *                 privately in the bot DM after confirmation, before approval.
 */

const { formatDate } = require('../utils/dates');
const { maternityLeavePeriod, leaveDurationLabel } = require('../utils/maternityLeave');

function formatMaternityDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

const LEAVE_TYPE_OPTIONS = [
  { text: { type: 'plain_text', text: '🏖️ Annual Leave', emoji: true }, value: 'Annual' },
  { text: { type: 'plain_text', text: '🤒 Sick Leave', emoji: true }, value: 'Sick' },
  { text: { type: 'plain_text', text: '🕌 Hajj Leave', emoji: true }, value: 'Hajj' },
  { text: { type: 'plain_text', text: '👶 Maternity Leave', emoji: true }, value: 'Maternity' },
];

function leaveTypeBlock(leaveType, maternityEligible = false) {
  const options = maternityEligible === true
    ? LEAVE_TYPE_OPTIONS
    : LEAVE_TYPE_OPTIONS.filter((option) => option.value !== 'Maternity');
  return {
    type: 'input',
    block_id: 'leave_type_block',
    dispatch_action: true,
    element: {
      type: 'static_select',
      action_id: 'leave_type_select',
      placeholder: { type: 'plain_text', text: 'Select leave type' },
      options,
      // Slack requires the exact text/value option record, including its label.
      initial_option: options.find((option) => option.value === leaveType),
    },
    label: { type: 'plain_text', text: 'Leave Type', emoji: true },
  };
}

function notesBlock(notes, isMaternity = false) {
  return {
    type: 'input',
    block_id: 'notes_block',
    optional: true,
    element: {
      type: 'plain_text_input',
      action_id: 'notes_input',
      multiline: true,
      placeholder: { type: 'plain_text', text: 'Any additional notes (optional)' },
      initial_value: notes || undefined,
      ...(isMaternity ? { max_length: 1000 } : {}),
    },
    label: { type: 'plain_text', text: 'Notes', emoji: true },
  };
}

/** Open immediately while the handler reads employee eligibility from Sheets. */
function buildLeaveLoadingModal({ unavailableMessage } = {}) {
  return {
    type: 'modal',
    callback_id: 'leave_request_loading',
    title: { type: 'plain_text', text: unavailableMessage ? 'Leave Unavailable' : 'Loading Leave' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: unavailableMessage || 'Loading your leave request form. Please wait…',
      },
    }],
  };
}

/** Step 1 — The initial form; the select action lets the handler swap forms. */
function buildLeaveRequestModal(prefill = {}, options = {}) {
  // UX filtering only; the handler must independently authorize every submission.
  const maternityEligible = options.maternityEligible === true;
  if (prefill.leaveType === 'Maternity' && maternityEligible) {
    return buildMaternityLeaveRequestModal(prefill, { maternityEligible });
  }
  return {
    type: 'modal',
    callback_id: 'leave_request_review',
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
      leaveTypeBlock(prefill.leaveType, maternityEligible),
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
      notesBlock(prefill.notes),
      { type: 'divider' },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `📎 *${maternityEligible ? 'Sick, Hajj or Maternity' : 'Sick or Hajj'} Leave?* After you confirm, the bot will send you a private message asking you to upload your documents directly there before approval. No public channels involved.`,
          },
        ],
      },
    ],
  };
}

/**
 * Maternity form — only the actual delivery date is editable. The review
 * handler calculates the inclusive last leave day and the return date.
 */
function buildMaternityLeaveRequestModal(prefill = {}, options = {}) {
  if (options.maternityEligible !== true) {
    return buildLeaveRequestModal(prefill, { maternityEligible: false });
  }
  return {
    type: 'modal',
    callback_id: 'maternity_leave_review',
    title: { type: 'plain_text', text: '👶 Maternity Leave', emoji: true },
    submit: { type: 'plain_text', text: 'Review Request →', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Maternity leave lasts *three calendar months* starting on the *actual delivery date, inclusive*. The last leave day and return date are calculated automatically; a third-month anniversary falling outside that month is adjusted to its last day. *No annual leave is deducted.* Enter the actual date, not an estimated due date.',
        },
      },
      { type: 'divider' },
      leaveTypeBlock('Maternity', true),
      {
        type: 'input',
        block_id: 'delivery_date_block',
        element: {
          type: 'datepicker',
          action_id: 'delivery_date_pick',
          placeholder: { type: 'plain_text', text: 'Select actual delivery date' },
          initial_date: prefill.deliveryDate || prefill.startDate || undefined,
        },
        label: { type: 'plain_text', text: 'Actual Delivery Date', emoji: true },
      },
      notesBlock(prefill.notes, true),
      { type: 'divider' },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: '📎 After confirming, the bot will ask you to upload a *document proving the actual delivery date* in your *private DM with the bot*, before the request can be sent for approval. Do not upload it in a public channel or this form.',
        }],
      },
    ],
  };
}

/**
 * Step 2 — Confirmation. The original call shape remains supported; maternity
 * callers may also provide deliveryDate, returnDate and dayBasis. Maternity
 * dates/duration are always derived from the actual delivery date so that no
 * editable end date or supplied working-day total can change the period.
 */
function buildConfirmationModal({
  leaveType, startDate, endDate, notes, totalDays, annualRemaining,
  deliveryDate, returnDate, dayBasis,
}) {
  const isMaternity = leaveType === 'Maternity';
  if (isMaternity) {
    deliveryDate = deliveryDate || startDate;
    ({ startDate, endDate, returnDate, totalDays } = maternityLeavePeriod(deliveryDate));
    dayBasis = 'calendar';
  }
  const leaveEmoji = leaveType === 'Annual' ? '🏖️'
    : leaveType === 'Sick' ? '🤒' : isMaternity ? '👶' : '🕌';

  let contextNote = '';
  if (leaveType === 'Annual') {
    const remainingAfter = annualRemaining - totalDays;
    contextNote = `After this request, you will have *${remainingAfter} day(s)* of annual leave remaining.`;
  } else if (leaveType === 'Sick') {
    contextNote = `📎 After confirming, the bot will send you a private DM asking you to upload your *Sehhaty (صحتي) screenshot* and *hospital report*.`;
  } else if (leaveType === 'Hajj') {
    contextNote = `📎 After confirming, the bot will send you a private DM asking you to upload your *official Hajj permission document*.`;
  } else if (isMaternity) {
    contextNote = 'Three calendar months from the actual delivery date, inclusive. *No annual leave is deducted.* 📎 After confirming, upload a *document proving the actual delivery date* in your *private DM with the bot*, as requested by the bot, before approval.';
  }

  const metadata = {
    leaveType, startDate, endDate, notes,
    ...(isMaternity ? { deliveryDate, returnDate, dayBasis } : {}),
  };
  const privateMetadata = JSON.stringify(metadata);
  if (privateMetadata.length > 3000) {
    throw new RangeError('Request notes are too long for the confirmation. Please shorten your notes.');
  }

  const fields = isMaternity ? [
    { type: 'mrkdwn', text: `*Leave Type:*\n${leaveEmoji} ${leaveType} Leave` },
    { type: 'mrkdwn', text: `*Total Calendar Days:*\n📅 *${leaveDurationLabel(leaveType, totalDays)}*` },
    { type: 'mrkdwn', text: `*Actual Delivery Date / Start Date (inclusive):*\n${formatMaternityDate(deliveryDate)}` },
    { type: 'mrkdwn', text: `*Last Leave Day (inclusive):*\n${formatMaternityDate(endDate)}` },
    { type: 'mrkdwn', text: `*Return Date (three-month anniversary):*\n${formatMaternityDate(returnDate)}` },
  ] : [
    { type: 'mrkdwn', text: `*Leave Type:*\n${leaveEmoji} ${leaveType} Leave` },
    { type: 'mrkdwn', text: `*Total Working Days:*\n📅 *${totalDays} day(s)*` },
    { type: 'mrkdwn', text: `*Start Date:*\n${formatDate(startDate)}` },
    { type: 'mrkdwn', text: `*End Date:*\n${formatDate(endDate)}` },
  ];

  return {
    type: 'modal',
    callback_id: 'leave_request_submit',
    title: { type: 'plain_text', text: '✅ Confirm Request', emoji: true },
    submit: { type: 'plain_text', text: 'Confirm + Submit', emoji: true },
    close: { type: 'plain_text', text: '← Go Back', emoji: true },
    private_metadata: privateMetadata,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Please review your leave request before submitting:*',
        },
      },
      { type: 'divider' },
      { type: 'section', fields },
      ...(notes ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Notes:*\n${notes}` },
      }] : []),
      { type: 'divider' },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: contextNote }],
      },
    ],
  };
}

module.exports = {
  LEAVE_TYPE_OPTIONS,
  buildLeaveLoadingModal,
  buildLeaveRequestModal,
  buildMaternityLeaveRequestModal,
  buildConfirmationModal,
};
