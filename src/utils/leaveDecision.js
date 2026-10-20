const { formatDate } = require('./dates');

function processedDecisionBlocks({ status, leaveType, slackUserId, employeeName, startDate, endDate, totalDays, managerId, reason = '', approvalHistory = '', nextStageLabel = '' }) {
  const processing = /Approval Processing$/.test(status) || status === 'Rejection Processing';
  const approved = status === 'Approved';
  const rejected = status === 'Rejected';
  const cancelled = status === 'Cancelled';
  const forwarded = status === 'Pending Department Head Approval' || status === 'Pending Company Head Approval';
  const icon = processing ? '⏳' : forwarded || approved ? '✅' : rejected ? '❌' : cancelled ? '🚫' : 'ℹ️';
  const title = processing ? 'Leave Decision Processing' : forwarded ? 'Leave Approval Forwarded' : approved ? 'Leave Approved' : rejected ? 'Leave Rejected' : cancelled ? 'Leave Cancelled' : 'Leave Status Updated';
  const decisionText = processing
    ? 'This decision is being processed. The Approve and Reject buttons have been removed to prevent duplicate approvals or notifications.'
    : forwarded
    ? `Thank you for approving this request. It has been sent to the ${nextStageLabel || (status.includes('Department') ? 'Department Head' : 'Company Head')} for the next approval.`
    : approved
    ? 'Thank you for approving this request. The employee and HR have been notified.'
    : rejected
      ? 'This leave request has been rejected. The employee has been notified with your feedback.'
      : cancelled
        ? 'This leave request was cancelled before it started. The employee, manager, and HR have been notified.'
        : `This leave request is now marked as ${status}.`;
  const decisionLabel = cancelled ? 'Status confirmed by' : approved || rejected || processing || forwarded ? 'Decision by' : 'Updated by';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${icon} *${title}*\n\n*Employee:* <@${slackUserId}> (${employeeName})\n*Leave Type:* ${leaveType} Leave\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*\n*${decisionLabel}:* <@${managerId}>${approvalHistory ? `\n\n*Approval History:*\n${approvalHistory}` : ''}${reason ? `\n*Notes:*\n> ${reason}` : ''}\n\n${decisionText}`,
      },
    },
  ];
}

module.exports = { processedDecisionBlocks };
