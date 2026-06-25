const { buildLeaveRequestModal, buildConfirmationModal } = require('../modals/leaveRequestModal');
const { buildRejectModal } = require('../modals/rejectModal');
const {
  getEmployeeBySlackId,
  addLeaveRequest,
  updateLeaveRequestStatus,
  updateLeaveRequestAttachments,
  updateEmployeeBalance,
} = require('../utils/sheets');
const { countWorkingDays, formatDate, generateRequestId } = require('../utils/dates');

/**
 * In-memory store for pending attachment requests.
 * Key: slackUserId  →  Value: { requestId, leaveType, managerId, employeeName, startDate, endDate, totalDays, notes, employeeRowIndex, annualUsed, annualRemaining, sickUsed, hajjUsed }
 *
 * When a Sick/Hajj request is submitted, we park the request here and wait for
 * the employee to send files in their DM with the bot. Once files arrive we
 * forward the full request to the manager and clear the entry.
 */
const pendingAttachments = new Map();

/**
 * Registers all leave-related handlers on the Bolt app.
 */
function registerLeaveHandlers(app) {

  // ─── /request-leave command ────────────────────────────────────────────────
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

  // ─── Step 1: Review handler — calculates days and shows confirmation modal ──
  app.view('leave_request_review', async ({ ack, view, body, client, logger }) => {
    const values = view.state.values;
    const slackUserId = body.user.id;
    const leaveType  = values.leave_type_block.leave_type_select.selected_option?.value;
    const startDate  = values.start_date_block.start_date_pick.selected_date;
    const endDate    = values.end_date_block.end_date_pick.selected_date;
    const notes      = values.notes_block.notes_input.value || '';

    // Validate first
    const errors = {};
    if (!leaveType)  errors.leave_type_block  = 'Please select a leave type.';
    if (!startDate)  errors.start_date_block  = 'Please select a start date.';
    if (!endDate)    errors.end_date_block    = 'Please select an end date.';
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      errors.end_date_block = 'End date must be after start date.';
    }
    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }

    try {
      const employee = await getEmployeeBySlackId(slackUserId);
      if (!employee) {
        await ack({ response_action: 'errors', errors: { leave_type_block: 'Your account is not registered in the HR system. Please contact HR.' } });
        return;
      }

      const totalDays = countWorkingDays(startDate, endDate);

      // Check annual balance at review stage so employee sees it before confirming
      if (leaveType === 'Annual' && totalDays > employee.annualRemaining) {
        await ack({ response_action: 'errors', errors: { end_date_block: `You only have ${employee.annualRemaining} day(s) of annual leave remaining, but you requested ${totalDays} day(s). Please adjust your dates.` } });
        return;
      }

      // Check Hajj one-time rule at review stage
      if (leaveType === 'Hajj' && employee.hajjUsed > 0) {
        await ack({ response_action: 'errors', errors: { leave_type_block: 'You have already used your Hajj leave entitlement. Hajj leave is available once per employee.' } });
        return;
      }

      // Push the confirmation modal
      await ack({
        response_action: 'push',
        view: buildConfirmationModal({
          leaveType,
          startDate,
          endDate,
          notes,
          totalDays,
          annualRemaining: employee.annualRemaining,
        }),
      });
    } catch (err) {
      logger.error('Error in review step:', err);
      await ack({ response_action: 'errors', errors: { leave_type_block: 'Something went wrong. Please try again.' } });
    }
  });

  // ─── Step 2: Final submission — reads data from private_metadata ───────────
  app.view('leave_request_submit', async ({ ack, view, body, client, logger }) => {
    await ack();
    const slackUserId = body.user.id;
    // Data comes from private_metadata set in the confirmation modal
    const { leaveType, startDate, endDate, notes } = JSON.parse(view.private_metadata || '{}');

    try {
      const employee = await getEmployeeBySlackId(slackUserId);
      if (!employee) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: '⚠️ Your Slack account is not registered in the HR system. Please contact HR to be added.',
        });
        return;
      }

      // ── Hajj: one-time check ────────────────────────────────────────────────
      if (leaveType === 'Hajj' && employee.hajjUsed > 0) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: '⚠️ You have already used your Hajj leave entitlement. Hajj leave is available once per employee.',
        });
        return;
      }

      // ── Annual: balance check ───────────────────────────────────────────────
      const totalDays = countWorkingDays(startDate, endDate);
      if (leaveType === 'Annual' && totalDays > employee.annualRemaining) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: `⚠️ You only have *${employee.annualRemaining} days* of annual leave remaining, but you requested *${totalDays} days*. Please adjust your dates.`,
        });
        return;
      }

      const requestId = generateRequestId();

      // ══════════════════════════════════════════════════════════════════════
      //  ANNUAL LEAVE — submit immediately, no attachments needed
      // ══════════════════════════════════════════════════════════════════════
      if (leaveType === 'Annual') {
        await addLeaveRequest({
          employeeName: employee.name,
          slackUserId,
          leaveType,
          startDate,
          endDate,
          totalDays,
          attachmentUrls: '',
          requestId,
        });

        await _notifyManager({
          client,
          managerId: employee.managerSlackId,
          slackUserId,
          employeeName: employee.name,
          leaveType,
          startDate,
          endDate,
          totalDays,
          notes,
          attachmentText: '',
          annualRemaining: employee.annualRemaining,
          requestId,
          rowIndex: employee.rowIndex,
          annualUsed: employee.annualUsed,
          sickUsed: employee.sickUsed,
          hajjUsed: employee.hajjUsed,
        });

        await client.chat.postMessage({
          channel: slackUserId,
          text: `✅ Your *Annual Leave* request has been submitted!`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Your Annual Leave request has been submitted!*\n\nYour manager has been notified and will review it shortly. You will receive a message here once a decision is made.\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*`,
              },
            },
          ],
        });
        return;
      }

      // ══════════════════════════════════════════════════════════════════════
      //  SICK / HAJJ LEAVE — park request and ask employee to upload documents
      // ══════════════════════════════════════════════════════════════════════
      pendingAttachments.set(slackUserId, {
        requestId,
        leaveType,
        managerId: employee.managerSlackId,
        employeeName: employee.name,
        startDate,
        endDate,
        totalDays,
        notes,
        annualRemaining: employee.annualRemaining,
        rowIndex: employee.rowIndex,
        annualUsed: employee.annualUsed,
        sickUsed: employee.sickUsed,
        hajjUsed: employee.hajjUsed,
      });

      // Save a "Pending Documents" record to Sheets so nothing is lost
      await addLeaveRequest({
        employeeName: employee.name,
        slackUserId,
        leaveType,
        startDate,
        endDate,
        totalDays,
        attachmentUrls: 'PENDING_UPLOAD',
        requestId,
        status: 'Pending Documents',
      });

      // Build the DM prompt based on leave type
      const isSick = leaveType === 'Sick';
      const dmText = isSick
        ? `🤒 *Sick Leave Request — Documents Required*\n\nYour request for *${formatDate(startDate)} → ${formatDate(endDate)}* (${totalDays} working day(s)) has been saved.\n\nTo complete your request, please send the following files *here in this chat*:\n\n*1.* Screenshot of your *Sehhaty (صحتي)* app showing the sick leave\n*2.* Your *hospital report* confirming the absence\n\nSimply send the files as messages in this chat — no links needed. Once I receive them, your request will be forwarded to your manager automatically. 📎`
        : `🕌 *Hajj Leave Request — Document Required*\n\nYour request for *${formatDate(startDate)} → ${formatDate(endDate)}* (${totalDays} working day(s)) has been saved.\n\nTo complete your request, please send your *official Hajj permission document* from the government *here in this chat*.\n\nSimply send the file as a message — no links needed. Once I receive it, your manager will be notified automatically. 📎`;

      await client.chat.postMessage({
        channel: slackUserId,
        text: dmText,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: dmText },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '🔒 These files are private. They will only be seen by you, your manager, and HR.',
              },
            ],
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

  // ─── Listen for file uploads in DMs (for Sick/Hajj pending requests) ───────
  app.event('message', async ({ event, client, logger }) => {
    try {
      // Only handle DMs (channel_type: 'im') that contain file attachments
      if (event.channel_type !== 'im') return;
      if (!event.files || event.files.length === 0) return;
      if (event.subtype === 'bot_message') return;

      const slackUserId = event.user;
      const pending = pendingAttachments.get(slackUserId);
      if (!pending) return; // No pending request for this user

      const {
        requestId, leaveType, managerId, employeeName,
        startDate, endDate, totalDays, notes,
        annualRemaining, rowIndex, annualUsed, sickUsed, hajjUsed,
      } = pending;

      // Collect all uploaded file permalinks
      const fileLinks = event.files
        .map((f) => `<${f.permalink}|${f.name}>`)
        .join('\n');

      // Update the Google Sheet with the real attachment URLs
      await updateLeaveRequestAttachments(requestId, fileLinks);

      // Clear the pending state
      pendingAttachments.delete(slackUserId);

      // Now notify the manager with the full request + file links
      await _notifyManager({
        client,
        managerId,
        slackUserId,
        employeeName,
        leaveType,
        startDate,
        endDate,
        totalDays,
        notes,
        attachmentText: fileLinks,
        annualRemaining,
        requestId,
        rowIndex,
        annualUsed,
        sickUsed,
        hajjUsed,
      });

      // Confirm to employee
      await client.chat.postMessage({
        channel: slackUserId,
        text: `✅ Documents received! Your *${leaveType} Leave* request has been forwarded to your manager.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Documents received!*\n\nYour *${leaveType} Leave* request has been forwarded to your manager for approval.\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*\n\nYou will receive a message here once a decision is made.`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error handling file upload:', err);
    }
  });

  // ─── Approve button ────────────────────────────────────────────────────────
  app.action('approve_leave', async ({ ack, body, action, client, logger }) => {
    await ack();
    const managerId = body.user.id;
    const data = JSON.parse(action.value);
    const { requestId, slackUserId, leaveType, startDate, endDate, totalDays, employeeName, rowIndex, annualUsed, annualRemaining, sickUsed, hajjUsed } = data;

    try {
      await updateLeaveRequestStatus(requestId, 'Approved', '');

      // Update balance in Google Sheets
      if (leaveType === 'Annual') {
        await updateEmployeeBalance(rowIndex, 'annualUsed', annualUsed + totalDays);
        await updateEmployeeBalance(rowIndex, 'annualRemaining', annualRemaining - totalDays);
      } else if (leaveType === 'Sick') {
        await updateEmployeeBalance(rowIndex, 'sickUsed', sickUsed + totalDays);
      } else if (leaveType === 'Hajj') {
        await updateEmployeeBalance(rowIndex, 'hajjUsed', 1);
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
              text: `🎉 *Your ${leaveType} Leave has been approved!*\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*\n\nEnjoy your time off! 🌟`,
            },
          },
        ],
      });

      // Update the manager's message to show approved state (removes buttons)
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `✅ Leave approved — ${employeeName}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *${leaveType} Leave — <@${slackUserId}>*\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} day(s))*\n\n*Status:* ✅ Approved by <@${managerId}>`,
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
    const data = JSON.parse(view.private_metadata);
    const { requestId, slackUserId, leaveType, startDate, endDate, totalDays } = data;
    const reason = view.state.values.rejection_reason_block.rejection_reason_input.value;

    try {
      await updateLeaveRequestStatus(requestId, 'Rejected', reason);

      await client.chat.postMessage({
        channel: slackUserId,
        text: `❌ Your ${leaveType} Leave request was not approved.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Your ${leaveType} Leave request was not approved.*\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*\n\n*Reason from your manager:*\n> ${reason}\n\nIf you have questions, please reach out to your manager directly.`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error processing rejection:', err);
    }
  });
}

// ─── Helper: send the full leave request to the manager ───────────────────────
async function _notifyManager({
  client, managerId, slackUserId, employeeName, leaveType,
  startDate, endDate, totalDays, notes, attachmentText,
  annualRemaining, requestId, rowIndex, annualUsed, sickUsed, hajjUsed,
}) {
  const leaveEmoji = leaveType === 'Annual' ? '🏖️' : leaveType === 'Sick' ? '🤒' : '🕌';

  const hajjNote = leaveType === 'Hajj'
    ? '\n\n> ℹ️ *Hajj Leave* is a legal entitlement (10 days). This notification is for your awareness — this leave will *not* be deducted from the employee\'s annual balance.'
    : '';
  const sickNote = leaveType === 'Sick'
    ? '\n\n> ℹ️ *Sick Leave* — HR will review the attached documents. If the report does not confirm a medical absence, the days will be deducted from the employee\'s annual balance.'
    : '';

  // Encode all data needed for approve/reject into the button value
  const buttonValue = JSON.stringify({
    requestId, slackUserId, leaveType, startDate, endDate,
    totalDays, employeeName, rowIndex, annualUsed,
    annualRemaining, sickUsed, hajjUsed,
  });

  await client.chat.postMessage({
    channel: managerId,
    text: `${leaveEmoji} New ${leaveType} Leave Request from ${employeeName}`,
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
          { type: 'mrkdwn', text: `*Annual Balance Left:*\n${annualRemaining} day(s)` },
        ],
      },
      ...(notes ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Notes from employee:*\n${notes}` },
      }] : []),
      ...(attachmentText ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*📎 Attached Documents:*\n${attachmentText}` },
      }] : []),
      ...((hajjNote || sickNote) ? [{
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
            value: buttonValue,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '❌ Reject', emoji: true },
            style: 'danger',
            action_id: 'reject_leave',
            value: buttonValue,
          },
        ],
      },
    ],
  });
}

module.exports = { registerLeaveHandlers };
