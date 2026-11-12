const { formatDate } = require('../utils/dates');
const { cancellationOptionText } = require('../utils/leaveCancellation');

function buildLeaveCancellationSelectModal(requests) {
  return {
    type: 'modal',
    callback_id: 'leave_cancellation_review',
    title: { type: 'plain_text', text: 'Cancel Approved Leave', emoji: true },
    submit: { type: 'plain_text', text: 'Review Cancellation', emoji: true },
    close: { type: 'plain_text', text: 'Keep Leave', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Cancel an upcoming approved leave request*\n\nYou can cancel the entire leave period before its start date. The app will restore the related leave balance automatically and notify your manager and HR. For a partial cancellation or leave that has already started, please contact HR.',
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'leave_to_cancel_block',
        element: {
          type: 'static_select',
          action_id: 'leave_to_cancel_select',
          placeholder: { type: 'plain_text', text: 'Select an approved upcoming leave' },
          options: requests.slice(0, 100).map((request) => ({
            text: { type: 'plain_text', text: cancellationOptionText(request).slice(0, 75) },
            value: request.requestId,
          })),
        },
        label: { type: 'plain_text', text: 'Leave to cancel', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'cancellation_reason_block',
        element: {
          type: 'plain_text_input',
          action_id: 'cancellation_reason_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Optional reason for your manager and HR' },
        },
        label: { type: 'plain_text', text: 'Reason (optional)', emoji: true },
      },
    ],
  };
}

function buildLeaveCancellationConfirmationModal({ request, reason }) {
  return {
    type: 'modal',
    callback_id: 'leave_cancellation_submit',
    title: { type: 'plain_text', text: 'Confirm Cancellation', emoji: true },
    submit: { type: 'plain_text', text: 'Cancel Leave', emoji: true },
    close: { type: 'plain_text', text: 'Keep Leave', emoji: true },
    private_metadata: JSON.stringify({ requestId: request.requestId, reason: reason || '' }),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '⚠️ *Please confirm the cancellation below.*\n\nThis cancels the entire approved leave period. Your manager and HR will be notified immediately.',
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Leave Type:*\n${request.leaveType} Leave` },
          { type: 'mrkdwn', text: `*Working Days:*\n${request.totalDays} day(s)` },
          { type: 'mrkdwn', text: `*Start Date:*\n${formatDate(request.startDate)}` },
          { type: 'mrkdwn', text: `*End Date:*\n${formatDate(request.endDate)}` },
        ],
      },
      ...(reason ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Reason:*\n${reason}` },
      }] : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: request.leaveType === 'Annual'
              ? `After cancellation, *${request.totalDays} annual leave day(s)* will be restored to your balance.`
              : 'The related leave record will be corrected because this leave has not started.',
          },
        ],
      },
    ],
  };
}

module.exports = {
  buildLeaveCancellationSelectModal,
  buildLeaveCancellationConfirmationModal,
};
