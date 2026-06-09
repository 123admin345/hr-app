const { buildLeaveRequestModal } = require('../modals/leaveRequestModal');
const { buildRejectModal } = require('../modals/rejectModal');
const { getEmployeeBySlackId, addLeaveRequest, updateLeaveRequestStatus, updateEmployeeBalance } = require('../utils/sheets');
const { countWorkingDays, formatDate, generateRequestId } = require('../utils/dates');

/**
 * Registers all leave-related handlers on the Bolt app.
 */
function registerLeaveHandlers(app) {

  // ─── /leave command ────────────────────────────────────────────────────────
  app.command('/request-leave', async ({ command, ack, client, logger }) => {
    await ack();
    try {
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildLeaveRequestModal(),
      });
    } catch (err) {
      logger.error('Error opening leave modal:', err);
    }
  });

  // ─── Modal submission ──────────────────────────────────────────────────────
  app.view('leave_request_submit', async ({ ack, view, body, client, logger }) => {
    const values = view.state.values;
    const slackUserId = body.user.id;
    const leaveType = values.leave_type_block.leave_type_select.selected_option?.value;
    const startDate = values.start_date_block.start_date_pick.selected_date;
    const endDate = values.end_date_block.end_date_pick.selected_date;
    const notes = values.notes_block.notes_input.value || '';
    const attachmentLinks = values.attachment_block.attachment_input.value || '';

    // ── Validation ─────────────────────────────────────────────────────────
    const errors = {};

    if (!leaveType) {
      errors.leave_type_block = 'Please select a leave type.';
    }
    if (!startDate || !endDate) {
      errors.start_date_block = 'Please select both start and end dates.';
    }
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      errors.end_date_block = 'End date must be after start date.';
    }
    if ((leaveType === 'Sick' || leaveType === 'Hajj') && !attachmentLinks.trim()) {
      errors.attachment_block = `Attachments are required for ${leaveType} Leave. Please share your documents in #leave-attachments and paste the links here.`;
    }

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }

    await ack();

    try {
      const employee = await getEmployeeBySlackId(slackUserId);
      if (!employee) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: '⚠️ Your Slack account is not registered in the HR system. Please contact HR to be added.',
        });
        return;
      }

      // ── Hajj: check if already used ────────────────────────────────────
      if (leaveType === 'Hajj' && employee.hajjUsed > 0) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: '⚠️ You have already used your Hajj leave entitlement. Hajj leave is available once per employee.',
        });
        return;
      }

      // ── Annual: check balance ──────────────────────────────────────────
      const totalDays = countWorkingDays(startDate, endDate);
      if (leaveType === 'Annual' && totalDays > employee.annualRemaining) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: `⚠️ You only have *${employee.annualRemaining} days* of annual leave remaining, but you requested *${totalDays} days*. Please adjust your dates.`,
        });
        return;
      }

      const requestId = generateRequestId();

      // ── Save to Google Sheets ──────────────────────────────────────────
      await addLeaveRequest({
        employeeName: employee.name,
        slackUserId,
        leaveType,
        startDate,
        endDate,
        totalDays,
        attachmentUrls: attachmentLinks,
        requestId,
      });

      // ── Notify manager ─────────────────────────────────────────────────
      const managerId = employee.managerSlackId;
      const leaveEmoji = leaveType === 'Annual' ? '🏖️' : leaveType === 'Sick' ? '🤒' : '🕌';
      const attachmentNote = attachmentLinks
        ? `\n*📎 Attachments:*\n${attachmentLinks}`
        : '';
      const hajjNote = leaveType === 'Hajj'
        ? '\n\n> ℹ️ *Hajj Leave* is a legal entitlement (10 days). Approval here is for your awareness — this leave will *not* be deducted from the employee\'s annual balance.'
        : '';
      const sickNote = leaveType === 'Sick'
        ? '\n\n> ℹ️ *Sick Leave* — HR will review the attached documents. If the report does not confirm a medical absence, the days will be deducted from the employee\'s annual balance.'
        : '';

      await client.chat.postMessage({
        channel: managerId,
        text: `${leaveEmoji} New ${leaveType} Leave Request`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${leaveEmoji} New ${leaveType} Leave Request`, emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Employee:*\n<@${slackUserId}>` },
              { type: 'mrkdwn', text: `*Leave Type:*\n${leaveType} Leave` },
              { type: 'mrkdwn', text: `*From:*\n${formatDate(startDate)}` },
              { type: 'mrkdwn', text: `*To:*\n${formatDate(endDate)}` },
              { type: 'mrkdwn', text: `*Working Days:*\n${totalDays} day(s)` },
              { type: 'mrkdwn', text: `*Remaining Balance:*\n${employee.annualRemaining} day(s)` },
            ],
          },
          ...(notes ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*Notes from employee:*\n${notes}` },
          }] : []),
          ...(attachmentLinks ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*📎 Attached Documents:*\n${attachmentLinks}` },
          }] : []),
          ...(hajjNote || sickNote ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: (hajjNote || sickNote).trim() },
          }] : []),
          { type: 'divider' },
          {
            type: 'actions',
            block_id: 'approval_actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '✅ Approve', emoji: true },
                style: 'primary',
                action_id: 'approve_leave',
                value: JSON.stringify({ requestId, slackUserId, leaveType, startDate, endDate, totalDays, employeeName: employee.name }),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '❌ Reject', emoji: true },
                style: 'danger',
                action_id: 'reject_leave',
                value: JSON.stringify({ requestId, slackUserId, leaveType, startDate, endDate, totalDays, employeeName: employee.name }),
              },
            ],
          },
        ],
      });

      // ── Confirm to employee ────────────────────────────────────────────
      await client.chat.postMessage({
        channel: slackUserId,
        text: `✅ Your *${leaveType} Leave* request has been submitted!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Your ${leaveType} Leave request has been submitted!*\n\nYour manager has been notified and will review it shortly. You will receive a direct message here once a decision is made.\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} (${totalDays} working day(s))`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error processing leave request:', err);
      await client.chat.postMessage({
        channel: slackUserId,
        text: '❌ Something went wrong while submitting your request. Please try again or contact HR.',
      });
    }
  });

  // ─── Approve button ────────────────────────────────────────────────────────
  app.action('approve_leave', async ({ ack, body, action, client, logger }) => {
    await ack();
    const managerId = body.user.id;
    const data = JSON.parse(action.value);
    const { requestId, slackUserId, leaveType, startDate, endDate, totalDays, employeeName } = data;

    try {
      await updateLeaveRequestStatus(requestId, 'Approved', '');

      // Update balance in Google Sheets
      const employee = await getEmployeeBySlackId(slackUserId);
      if (employee) {
        if (leaveType === 'Annual') {
          const newUsed = employee.annualUsed + totalDays;
          const newRemaining = employee.annualRemaining - totalDays;
          await updateEmployeeBalance(employee.rowIndex, 'annualUsed', newUsed);
          await updateEmployeeBalance(employee.rowIndex, 'annualRemaining', newRemaining);
        } else if (leaveType === 'Sick') {
          await updateEmployeeBalance(employee.rowIndex, 'sickUsed', employee.sickUsed + totalDays);
        } else if (leaveType === 'Hajj') {
          await updateEmployeeBalance(employee.rowIndex, 'hajjUsed', 1);
        }
      }

      // Notify employee
      await client.chat.postMessage({
        channel: slackUserId,
        text: `🎉 Your ${leaveType} Leave has been approved!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🎉 *Your ${leaveType} Leave has been approved!*\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} (${totalDays} working day(s))\n\nEnjoy your time off! 🌟`,
            },
          },
        ],
      });

      // Update manager's message to show approved state
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `✅ Leave request from ${employeeName} — *Approved* by <@${managerId}>`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *${leaveType} Leave request from <@${slackUserId}>*\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} (${totalDays} day(s))\n\n*Status:* Approved by <@${managerId}>`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error approving leave:', err);
    }
  });

  // ─── Reject button ─────────────────────────────────────────────────────────
  app.action('reject_leave', async ({ ack, body, action, client, logger }) => {
    await ack();
    const data = JSON.parse(action.value);
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildRejectModal(action.value, data.employeeName),
      });
    } catch (err) {
      logger.error('Error opening reject modal:', err);
    }
  });

  // ─── Rejection feedback submission ────────────────────────────────────────
  app.view('reject_feedback_submit', async ({ ack, view, body, client, logger }) => {
    await ack();
    const managerId = body.user.id;
    const rawData = view.private_metadata;
    const data = JSON.parse(rawData);
    const { requestId, slackUserId, leaveType, startDate, endDate, totalDays, employeeName } = data;
    const reason = view.state.values.rejection_reason_block.rejection_reason_input.value;

    try {
      await updateLeaveRequestStatus(requestId, 'Rejected', reason);

      // Notify employee with feedback
      await client.chat.postMessage({
        channel: slackUserId,
        text: `❌ Your ${leaveType} Leave request was not approved.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Your ${leaveType} Leave request was not approved.*\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} (${totalDays} working day(s))\n\n*Reason from your manager:*\n> ${reason}\n\nIf you have questions, please reach out to your manager directly.`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error processing rejection:', err);
    }
  });
}

module.exports = { registerLeaveHandlers };
