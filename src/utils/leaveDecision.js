const { formatDate } = require('./dates');

function processedDecisionBlocks({ status, leaveType, slackUserId, employeeName, startDate, endDate, totalDays, managerId, reason = '' }) {
  const approved = status === 'Approved';
  const rejected = status === 'Rejected';
  const cancelled = status === 'Cancelled';
  const icon = approved ? '✅' : rejected ? '❌' : cancelled ? '🚫' : 'ℹ️';
  const title = approved ? 'Leave Approved' : rejected ? 'Leave Rejected' : cancelled ? 'Leave Cancelled' : 'Leave Status Updated';
  const decisionText = approved
    ? 'Thank you for approving this request. The employee and HR have been notified.'
    : rejected
      ? 'This leave request has been rejected. The employee has been notified with your feedback.'
      : cancelled
        ? 'This leave request was cancelled before it started. The employee, manager, and HR have been notified.'
        : `This leave request is now marked as ${status}.`;
  const decisionLabel = cancelled ? 'Status confirmed by' : approved || rejected ? 'Decision by' : 'Updated by';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${title}*\n\n*Employee:* <@${slackUserId}> (${employeeName})\n*Leave Type:* ${leaveType} Leave\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*\n*${decisionLabel}:* <@${managerId}>${reason ? `\n*Notes:*\n> ${reason}` : ''}\n\n${decisionText}`,
      },
    },
  ];
}

module.exports = { processedDecisionBlocks };
