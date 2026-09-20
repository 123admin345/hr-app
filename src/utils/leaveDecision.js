const { formatDate } = require('./dates');

function processedDecisionBlocks({ status, leaveType, slackUserId, employeeName, startDate, endDate, totalDays, managerId, reason = '' }) {
  const approved = status === 'Approved';
  const icon = approved ? '✅' : '❌';
  const title = approved ? 'Leave Approved' : 'Leave Rejected';
  const decisionText = approved
    ? 'Thank you for approving this request. The employee and HR have been notified.'
    : 'This leave request has been rejected. The employee has been notified with your feedback.';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${title}*\n\n*Employee:* <@${slackUserId}> (${employeeName})\n*Leave Type:* ${leaveType} Leave\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*\n*Decision by:* <@${managerId}>${reason ? `\n*Manager feedback:*\n> ${reason}` : ''}\n\n${decisionText}`,
      },
    },
  ];
}

module.exports = { processedDecisionBlocks };
