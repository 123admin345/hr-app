/**
 * Builds the Block Kit modal for a manager to provide rejection feedback.
 */

function buildRejectModal(requestId, employeeName) {
  return {
    type: 'modal',
    callback_id: 'reject_feedback_submit',
    private_metadata: requestId,
    title: { type: 'plain_text', text: '❌ Reject Request', emoji: true },
    submit: { type: 'plain_text', text: 'Confirm Rejection', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `You are rejecting the leave request from *${employeeName}*. Please provide a reason so they can understand and resubmit if needed.`,
        },
      },
      {
        type: 'input',
        block_id: 'rejection_reason_block',
        element: {
          type: 'plain_text_input',
          action_id: 'rejection_reason_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'e.g., "We have a critical deadline during this period. Please consider rescheduling."',
          },
        },
        label: { type: 'plain_text', text: 'Reason for Rejection', emoji: true },
      },
    ],
  };
}

module.exports = { buildRejectModal };
