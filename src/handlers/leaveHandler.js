const { buildLeaveRequestModal, buildConfirmationModal } = require('../modals/leaveRequestModal');
const { buildRejectModal } = require('../modals/rejectModal');
const {
  getEmployeeBySlackId,
  addLeaveRequest,
  updateLeaveRequestStatus,
  updateLeaveRequestApprovalData,
  claimLeaveRequestDecision,
  getLeaveRequestById,
  getLeaveRequestsBySlackId,
  updateLeaveRequestAttachments,
  updateEmployeeBalance,
  updateEmployeeBalances,
} = require('../utils/sheets');
const { countWorkingDays, formatDate, generateRequestId, saudiTodayDateString } = require('../utils/dates');
const { processedDecisionBlocks } = require('../utils/leaveDecision');
const {
  buildLeaveCancellationSelectModal,
  buildLeaveCancellationConfirmationModal,
} = require('../modals/leaveCancellationModal');
const {
  isEmployeeCancelableLeave,
  restoredLeaveBalances,
  cancellationSummaryForEmployee,
} = require('../utils/leaveCancellation');
const {
  getLeaveApprovalStages,
  getStageForLeaveRequest,
  getApproverIdForStage,
  approvalRouteText,
  approvalRecord,
  approvalTrailText,
} = require('../utils/leaveApprovalWorkflow');

const COMPANY_HEAD_SLACK_ID = process.env.COMPANY_HEAD_SLACK_ID || process.env.OWNER_SLACK_ID || '';

// Employee Balances column R can select a different Company Head for the
// employee's company. The existing owner setting remains only a safe fallback.
function companyHeadSlackIdFor(employee = {}) {
  return employee.companyHeadSlackId || COMPANY_HEAD_SLACK_ID;
}

/**
 * In-memory store for pending attachment requests.
 * Key: slackUserId  →  Value: { requestId, leaveType, managerId, employeeName, startDate, endDate, totalDays, notes, employeeRowIndex, annualUsed, annualRemaining, sickUsed, hajjUsed }
 *
 * When a Sick/Hajj request is submitted, we park the request here and wait for
 * the employee to send files in their DM with the bot. Once files arrive we
 * forward the full request to the manager and clear the entry.
 */
const pendingAttachments = new Map();
const processingLeaveDecisions = new Set();
const processingLeaveCancellations = new Set();

function managerMessageLocation(body) {
  return {
    channel: body.channel?.id || body.container?.channel_id,
    ts: body.message?.ts || body.container?.message_ts,
  };
}

async function replaceManagerDecisionMessage(client, body, details) {
  const { channel, ts } = managerMessageLocation(body);
  if (!channel || !ts) return;
  const icon = /Processing$/.test(details.status) ? '⏳'
    : details.status === 'Rejected' ? '❌'
      : details.status === 'Cancelled' ? '🚫'
        : /Pending (Department Head|Company Head) Approval/.test(details.status) || details.status === 'Approved' ? '✅'
          : 'ℹ️';
  await client.chat.update({
    channel,
    ts,
    text: `${icon} Leave ${details.status.toLowerCase()} — ${details.employeeName}`,
    blocks: processedDecisionBlocks(details),
  });
}

async function _notifyLeaveApprover({ client, employee, request, notes = '', attachmentText = '' }) {
  const companyHeadSlackId = companyHeadSlackIdFor(employee);
  const stage = getStageForLeaveRequest(request, employee, companyHeadSlackId);
  if (!stage) throw new Error(`This leave request is not waiting for an approval stage. Current status: ${request.status}.`);
  const approverId = getApproverIdForStage(stage, employee, companyHeadSlackId);
  if (!approverId) throw new Error(`No ${stage.label} Slack ID is configured for this leave request.`);
  await _notifyManager({
    client,
    managerId: approverId,
    slackUserId: request.slackUserId,
    employeeName: request.employeeName,
    leaveType: request.leaveType,
    startDate: request.startDate,
    endDate: request.endDate,
    totalDays: request.totalDays,
    notes,
    attachmentText: attachmentText || request.attachmentUrls || '',
    annualRemaining: employee.annualRemaining,
    requestId: request.requestId,
    approvalStage: stage,
    approvalHistory: approvalTrailText(request),
    approvalRoute: approvalRouteText(employee),
  });
}

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

  // ─── /cancel-leave command ────────────────────────────────────────────────
  // Employees may cancel their own approved leave only before its start date.
  app.command('/cancel-leave', async ({ command, ack, client, logger }) => {
    await ack();
    try {
      const employee = await getEmployeeBySlackId(command.user_id);
      if (!employee) {
        await client.chat.postMessage({
          channel: command.user_id,
          text: '⚠️ Your Slack account is not registered in the HR system. Please contact HR.',
        });
        return;
      }

      const requests = await getLeaveRequestsBySlackId(command.user_id);
      const cancelableRequests = requests.filter((request) => (
        isEmployeeCancelableLeave(request, command.user_id, saudiTodayDateString())
      ));

      if (cancelableRequests.length === 0) {
        await client.chat.postMessage({
          channel: command.user_id,
          text: 'There is no approved upcoming leave available to cancel. You can cancel an entire approved leave period only before its start date. For a partial cancellation or leave that has already started, please contact HR.',
        });
        return;
      }

      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildLeaveCancellationSelectModal(cancelableRequests),
      });
    } catch (err) {
      logger.error('Error opening leave cancellation modal:', err);
      await client.chat.postMessage({
        channel: command.user_id,
        text: '❌ Something went wrong while opening leave cancellation. Please try again or contact HR.',
      });
    }
  });

  // ─── Leave cancellation selection ─────────────────────────────────────────
  app.view('leave_cancellation_review', async ({ ack, view, body, client, logger }) => {
    const selectedRequestId = view.state.values.leave_to_cancel_block.leave_to_cancel_select.selected_option?.value;
    const reason = view.state.values.cancellation_reason_block.cancellation_reason_input.value || '';

    try {
      const request = await getLeaveRequestById(selectedRequestId);
      if (!isEmployeeCancelableLeave(request, body.user.id, saudiTodayDateString())) {
        await ack({
          response_action: 'errors',
          errors: {
            leave_to_cancel_block: 'This leave is no longer available for self-cancellation. Please contact HR for assistance.',
          },
        });
        return;
      }

      await ack({
        response_action: 'push',
        view: buildLeaveCancellationConfirmationModal({ request, reason }),
      });
    } catch (err) {
      logger.error('Error reviewing leave cancellation:', err);
      await ack({
        response_action: 'errors',
        errors: {
          leave_to_cancel_block: 'Something went wrong. Please try again or contact HR.',
        },
      });
    }
  });

  // ─── Leave cancellation confirmation ──────────────────────────────────────
  app.view('leave_cancellation_submit', async ({ ack, view, body, client, logger }) => {
    await ack();
    const { requestId, reason = '' } = JSON.parse(view.private_metadata || '{}');
    const employeeSlackId = body.user.id;

    if (processingLeaveCancellations.has(requestId)) return;
    processingLeaveCancellations.add(requestId);

    try {
      const [employee, request] = await Promise.all([
        getEmployeeBySlackId(employeeSlackId),
        getLeaveRequestById(requestId),
      ]);

      if (!employee || !isEmployeeCancelableLeave(request, employeeSlackId, saudiTodayDateString())) {
        await client.chat.postMessage({
          channel: employeeSlackId,
          text: '⚠️ This leave is no longer available for self-cancellation. For a partial cancellation or leave that has already started, please contact HR.',
        });
        return;
      }

      const restoredBalances = restoredLeaveBalances(employee, request);
      const balanceUpdates = { ...restoredBalances };
      delete balanceUpdates.summary;
      const cancellationNote = `Cancelled by employee before leave started.${reason ? ` Reason: ${reason}` : ''}`;

      // Mark first so a simultaneous manager click sees that cancellation is in progress.
      await updateLeaveRequestStatus(requestId, 'Cancellation Processing', cancellationNote);
      await updateEmployeeBalances(employee.rowIndex, balanceUpdates);
      await updateLeaveRequestStatus(requestId, 'Cancelled', cancellationNote);
      pendingAttachments.delete(employeeSlackId);

      const employeeMessage = `🚫 *Your ${request.leaveType} Leave has been cancelled.*\n\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${request.totalDays} working day(s))*\n\n${cancellationSummaryForEmployee(request, restoredBalances)}\n\nYour manager and HR have been notified.${reason ? `\n\n*Your reason:*\n> ${reason}` : ''}`;
      const managerMessage = `🚫 *Leave Cancelled by Employee*\n\n*Employee:* <@${employeeSlackId}> (${employee.name})\n*Leave Type:* ${request.leaveType} Leave\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${request.totalDays} working day(s))*\n\nThe leave had not started. The app has updated the leave record and related balance. No manager action is needed.${reason ? `\n\n*Employee reason:*\n> ${reason}` : ''}`;
      const hrChannelId = process.env.HR_CHANNEL_ID;
      const hrMessage = `🚫 *Leave Cancelled by Employee*\n\n*Employee:* <@${employeeSlackId}> (${employee.name})\n*Leave Type:* ${request.leaveType} Leave\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${request.totalDays} working day(s))*\n*Balance update:* ${restoredBalances.summary}\n\nThe leave was cancelled before it started. No HR action is required unless further changes are needed.${reason ? `\n\n*Employee reason:*\n> ${reason}` : ''}`;
      const notificationResults = await Promise.allSettled([
        client.chat.postMessage({ channel: employeeSlackId, text: employeeMessage }),
        ...(employee.managerSlackId
          ? [client.chat.postMessage({ channel: employee.managerSlackId, text: managerMessage })]
          : []),
        ...(hrChannelId
          ? [client.chat.postMessage({ channel: hrChannelId, text: hrMessage })]
          : []),
      ]);
      for (const result of notificationResults) {
        if (result.status === 'rejected') {
          logger.error('Leave cancellation notification error:', result.reason);
        }
      }
    } catch (err) {
      logger.error('Error cancelling leave:', err);
      try {
        await updateLeaveRequestStatus(
          requestId,
          'Cancellation Needs HR Review',
          `Employee attempted cancellation. HR must verify the record and balance.${reason ? ` Reason: ${reason}` : ''}`,
        );
      } catch (statusErr) {
        logger.error('Error recording leave cancellation issue:', statusErr);
      }
      await client.chat.postMessage({
        channel: employeeSlackId,
        text: '⚠️ Your cancellation needs HR review before it can be completed. HR has been asked to verify the leave record and balance. Please do not submit another cancellation request.',
      });
    } finally {
      processingLeaveCancellations.delete(requestId);
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

      // Validate a configured multi-level route before saving any leave record.
      // Normal employees continue with their existing single-manager route.
      try {
        getLeaveApprovalStages(employee, companyHeadSlackIdFor(employee));
      } catch (routeError) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: `⚠️ Your leave approval route needs an HR update before you can submit this request. Please contact HR. (${routeError.message})`,
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

        await _notifyLeaveApprover({
          client,
          employee,
          request: {
            requestId, status: 'Pending', slackUserId, employeeName: employee.name,
            leaveType, startDate, endDate, totalDays,
          },
          notes,
          attachmentText: '',
        });

        await client.chat.postMessage({
          channel: slackUserId,
          text: `✅ Your *Annual Leave* request has been submitted!`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Your Annual Leave request has been submitted!*\n\n*Approval route:* ${approvalRouteText(employee)}\n\nYour first approver has been notified and will review it shortly. You will receive a message here once a decision is made.\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*`,
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
        employee,
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
        requestId, leaveType, employee, employeeName,
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

      // Now notify the first configured approver with the full request + file links
      await _notifyLeaveApprover({
        client,
        employee,
        request: {
          requestId, status: 'Pending', slackUserId, employeeName,
          leaveType, startDate, endDate, totalDays,
        },
        notes,
        attachmentText: fileLinks,
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
              text: `✅ *Documents received!*\n\nYour *${leaveType} Leave* request has been forwarded to the first required approver.\n\n*Approval route:* ${approvalRouteText(employee)}\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${totalDays} working day(s))*\n\nYou will receive a message here once a decision is made.`,
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
    const { requestId } = data;
    let decisionClaimed = false;
    let approvalSaved = false;

    try {
      if (processingLeaveDecisions.has(requestId)) return;
      processingLeaveDecisions.add(requestId);
      const pendingRequest = await getLeaveRequestById(requestId);
      if (!pendingRequest) throw new Error('This leave request could not be found.');
      const employee = await getEmployeeBySlackId(pendingRequest.slackUserId);
      if (!employee) throw new Error('The employee for this leave request could not be found.');
      const companyHeadSlackId = companyHeadSlackIdFor(employee);
      const stage = getStageForLeaveRequest(pendingRequest, employee, companyHeadSlackId);
      if (!stage) {
        await replaceManagerDecisionMessage(client, body, {
          status: pendingRequest.status,
          leaveType: pendingRequest.leaveType,
          slackUserId: pendingRequest.slackUserId,
          employeeName: pendingRequest.employeeName,
          startDate: pendingRequest.startDate,
          endDate: pendingRequest.endDate,
          totalDays: pendingRequest.totalDays,
          managerId,
          reason: pendingRequest.managerNotes,
          approvalHistory: approvalTrailText(pendingRequest),
        });
        return;
      }
      const requiredApproverId = getApproverIdForStage(stage, employee, companyHeadSlackId);
      if (requiredApproverId !== managerId) {
        await client.chat.postMessage({ channel: managerId, text: `⚠️ Only the assigned ${stage.label} can approve this leave request.` });
        return;
      }
      const claim = await claimLeaveRequestDecision(requestId, stage.processingStatus, stage.pendingStatus);
      if (!claim.claimed) {
        const existingRequest = claim.request;
        if (!existingRequest) throw new Error('This leave request could not be found.');
        await replaceManagerDecisionMessage(client, body, {
          status: existingRequest.status,
          leaveType: existingRequest.leaveType,
          slackUserId: existingRequest.slackUserId,
          employeeName: existingRequest.employeeName,
          startDate: existingRequest.startDate,
          endDate: existingRequest.endDate,
          totalDays: existingRequest.totalDays,
          managerId,
          reason: existingRequest.managerNotes,
          approvalHistory: approvalTrailText(existingRequest),
        });
        return;
      }
      decisionClaimed = true;
      const request = claim.request;

      // Remove action buttons immediately. A second Slack click now sees Approval Processing.
      try {
        await replaceManagerDecisionMessage(client, body, {
          status: stage.processingStatus,
          leaveType: request.leaveType,
          slackUserId: request.slackUserId,
          employeeName: request.employeeName,
          startDate: request.startDate,
          endDate: request.endDate,
          totalDays: request.totalDays,
          managerId,
          approvalHistory: approvalTrailText(request),
        });
      } catch (messageError) {
        logger.error('Unable to replace approval buttons while processing leave:', messageError);
      }

      const stages = getLeaveApprovalStages(employee, companyHeadSlackId);
      const stageIndex = stages.findIndex((item) => item.key === stage.key);
      const nextStage = stages[stageIndex + 1] || null;
      const approvalValue = approvalRecord({ approverId: managerId, stageLabel: stage.label });
      const approvedRequest = await updateLeaveRequestApprovalData(requestId, {
        ...(nextStage ? { status: stage.approvedStatus } : {}),
        [stage.approvalField]: approvalValue,
      });

      // For three-level employees, level 1 and level 2 approve then forward.
      // Leave balances and final employee/HR messages happen only at the final stage.
      if (nextStage) {
        approvalSaved = true;
        await _notifyLeaveApprover({
          client,
          employee,
          request: approvedRequest,
          notes: approvedRequest.managerNotes,
          attachmentText: approvedRequest.attachmentUrls,
        });
        await client.chat.postMessage({
          channel: request.slackUserId,
          text: `✅ Your ${request.leaveType} Leave request was approved by your ${stage.label} and has been sent to the ${nextStage.label} for the next approval.`,
        });
        await replaceManagerDecisionMessage(client, body, {
          status: stage.approvedStatus,
          leaveType: request.leaveType,
          slackUserId: request.slackUserId,
          employeeName: request.employeeName,
          startDate: request.startDate,
          endDate: request.endDate,
          totalDays: request.totalDays,
          managerId,
          approvalHistory: approvalTrailText(approvedRequest),
          nextStageLabel: nextStage.label,
        });
        return;
      }

      // Use the current employee row, not balance values stored in an older Slack button.
      if (request.leaveType === 'Annual') {
        await updateEmployeeBalances(employee.rowIndex, {
          annualUsed: employee.annualUsed + request.totalDays,
          annualRemaining: employee.annualRemaining - request.totalDays,
        });
      } else if (request.leaveType === 'Sick') {
        await updateEmployeeBalance(employee.rowIndex, 'sickUsed', employee.sickUsed + request.totalDays);
      } else if (request.leaveType === 'Hajj') {
        await updateEmployeeBalance(employee.rowIndex, 'hajjUsed', 1);
      }
      await updateLeaveRequestApprovalData(requestId, { status: 'Approved' });
      approvalSaved = true;

      // Notify employee
      await client.chat.postMessage({
        channel: request.slackUserId,
        text: `🎉 Your ${request.leaveType} Leave has been approved!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🎉 *Your ${request.leaveType} Leave has been approved!*\n\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${request.totalDays} working day(s))*\n\nEnjoy your time off! 🌟`,
            },
          },
        ],
      });

      // Notify HR channel
      const hrChannelId = process.env.HR_CHANNEL_ID;
      if (hrChannelId) {
        const leaveEmoji = request.leaveType === 'Annual' ? '🏖️' : request.leaveType === 'Sick' ? '🤒' : '🕌';
        await client.chat.postMessage({
          channel: hrChannelId,
          text: `${leaveEmoji} Leave Approved — ${request.employeeName}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${leaveEmoji} *Leave Approved*\n\n*Employee:* <@${request.slackUserId}> (${request.employeeName})\n*Leave Type:* ${request.leaveType} Leave\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${request.totalDays} working day(s))*\n*Approved by:* <@${managerId}>`,
              },
            },
          ],
        });
      }

      // Replace the original buttons with the final decision so no second action is needed.
      await replaceManagerDecisionMessage(client, body, {
        status: 'Approved', leaveType: request.leaveType, slackUserId: request.slackUserId, employeeName: request.employeeName,
        startDate: request.startDate, endDate: request.endDate, totalDays: request.totalDays, managerId,
        approvalHistory: approvalTrailText(approvedRequest),
      });

    } catch (err) {
      logger.error('Error approving leave:', err);
      if (decisionClaimed && !approvalSaved) {
        try {
          await updateLeaveRequestStatus(requestId, 'Approval Needs HR Review', 'Approval could not be completed automatically. HR must verify the leave record and balance before taking action.');
          await replaceManagerDecisionMessage(client, body, {
            status: 'Approval Needs HR Review',
            leaveType: data.leaveType,
            slackUserId: data.slackUserId,
            employeeName: data.employeeName,
            startDate: data.startDate,
            endDate: data.endDate,
            totalDays: data.totalDays,
            managerId,
          });
        } catch (recoveryError) {
          logger.error('Unable to record failed leave approval for HR review:', recoveryError);
        }
      }
    } finally {
      processingLeaveDecisions.delete(requestId);
    }
  });

  // ─── Reject button ─────────────────────────────────────────────────────────
  app.action('reject_leave', async ({ ack, body, action, client, logger }) => {
    await ack();
    const data = JSON.parse(action.value);
    try {
      const existingRequest = await getLeaveRequestById(data.requestId);
      const employee = existingRequest ? await getEmployeeBySlackId(existingRequest.slackUserId) : null;
      const stage = employee ? getStageForLeaveRequest(existingRequest, employee, companyHeadSlackIdFor(employee)) : null;
      if (!existingRequest || !employee || !stage || processingLeaveDecisions.has(data.requestId)) {
        if (existingRequest) {
          await replaceManagerDecisionMessage(client, body, {
            status: existingRequest.status,
            leaveType: existingRequest.leaveType,
            slackUserId: existingRequest.slackUserId,
            employeeName: existingRequest.employeeName,
            startDate: existingRequest.startDate,
            endDate: existingRequest.endDate,
            totalDays: existingRequest.totalDays,
            managerId: body.user.id,
            reason: existingRequest.managerNotes,
            approvalHistory: approvalTrailText(existingRequest),
          });
        }
        return;
      }
      if (getApproverIdForStage(stage, employee, companyHeadSlackIdFor(employee)) !== body.user.id) {
        await client.chat.postMessage({ channel: body.user.id, text: `⚠️ Only the assigned ${stage.label} can reject this leave request.` });
        return;
      }
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildRejectModal(JSON.stringify({ requestId: data.requestId, ...managerMessageLocation(body) }), existingRequest.employeeName),
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
    const { requestId } = data;
    const reason = view.state.values.rejection_reason_block.rejection_reason_input.value;

    let decisionClaimed = false;
    let rejectionSaved = false;
    try {
      if (processingLeaveDecisions.has(requestId)) return;
      processingLeaveDecisions.add(requestId);
      const pendingRequest = await getLeaveRequestById(requestId);
      if (!pendingRequest) throw new Error('This leave request could not be found.');
      const employee = await getEmployeeBySlackId(pendingRequest.slackUserId);
      if (!employee) throw new Error('The employee for this leave request could not be found.');
      const stage = getStageForLeaveRequest(pendingRequest, employee, companyHeadSlackIdFor(employee));
      if (!stage) throw new Error('This leave request is no longer awaiting approval.');
      if (getApproverIdForStage(stage, employee, companyHeadSlackIdFor(employee)) !== managerId) {
        throw new Error(`Only the assigned ${stage.label} can reject this leave request.`);
      }
      const claim = await claimLeaveRequestDecision(requestId, 'Rejection Processing', stage.pendingStatus);
      if (!claim.claimed) return;
      decisionClaimed = true;
      const existingRequest = claim.request;
      const rejectedRecord = `Rejected — ${stage.label}: ${managerId} — ${new Date().toISOString()}${reason ? ` — ${reason}` : ''}`;
      const rejectedRequest = await updateLeaveRequestApprovalData(requestId, {
        status: 'Rejected',
        managerNotes: reason,
        [stage.approvalField]: rejectedRecord,
      });
      rejectionSaved = true;

      await client.chat.postMessage({
        channel: existingRequest.slackUserId,
        text: `❌ Your ${existingRequest.leaveType} Leave request was not approved.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Your ${existingRequest.leaveType} Leave request was not approved.*\n\n*Dates:* ${formatDate(existingRequest.startDate)} → ${formatDate(existingRequest.endDate)} *(${existingRequest.totalDays} working day(s))*\n\n*Decision level:* ${stage.label}\n*Reason:*\n> ${reason}\n\nIf you have questions, please reach out to your manager directly.`,
            },
          },
        ],
      });

      await replaceManagerDecisionMessage(client, { channel: { id: data.channel }, message: { ts: data.ts } }, {
        status: 'Rejected', leaveType: existingRequest.leaveType, slackUserId: existingRequest.slackUserId, employeeName: existingRequest.employeeName,
        startDate: existingRequest.startDate, endDate: existingRequest.endDate, totalDays: existingRequest.totalDays, managerId, reason,
        approvalHistory: approvalTrailText(rejectedRequest),
      });

    } catch (err) {
      logger.error('Error processing rejection:', err);
      if (decisionClaimed && !rejectionSaved) {
        try {
          await updateLeaveRequestStatus(requestId, 'Rejection Needs HR Review', 'Rejection could not be completed automatically. HR must verify the leave record before taking action.');
          const currentRequest = await getLeaveRequestById(requestId);
          if (currentRequest) {
            await replaceManagerDecisionMessage(client, { channel: { id: data.channel }, message: { ts: data.ts } }, {
              status: 'Rejection Needs HR Review', leaveType: currentRequest.leaveType, slackUserId: currentRequest.slackUserId,
              employeeName: currentRequest.employeeName, startDate: currentRequest.startDate, endDate: currentRequest.endDate,
              totalDays: currentRequest.totalDays, managerId, approvalHistory: approvalTrailText(currentRequest),
            });
          }
        } catch (recoveryError) {
          logger.error('Unable to record failed leave rejection for HR review:', recoveryError);
        }
      }
    } finally {
      processingLeaveDecisions.delete(requestId);
    }
  });
}

// ─── Helper: send the full leave request to the manager ───────────────────────
async function _notifyManager({
  client, managerId, slackUserId, employeeName, leaveType,
  startDate, endDate, totalDays, notes, attachmentText,
  annualRemaining, requestId, approvalStage, approvalHistory = '', approvalRoute = '',
}) {
  const leaveEmoji = leaveType === 'Annual' ? '🏖️' : leaveType === 'Sick' ? '🤒' : '🕌';
  const approvalTitle = approvalStage?.key === 'final_manager'
    ? 'Leave Approval Required'
    : `Leave Approval Required — ${approvalStage?.label || 'Manager'}`;

  const hajjNote = leaveType === 'Hajj'
    ? '\n\n> ℹ️ *Hajj Leave* is a legal entitlement (10 days). This notification is for your awareness — this leave will *not* be deducted from the employee\'s annual balance.'
    : '';
  const sickNote = leaveType === 'Sick'
    ? '\n\n> ℹ️ *Sick Leave* — HR will review the attached documents. If the report does not confirm a medical absence, the days will be deducted from the employee\'s annual balance.'
    : '';

  // The server reads the current request from Google Sheets. The button only
  // carries its request ID so prior stages cannot be bypassed with stale data.
  const buttonValue = JSON.stringify({ requestId });

  await client.chat.postMessage({
    channel: managerId,
    text: `${leaveEmoji} ${approvalTitle} — ${employeeName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${leaveEmoji} ${approvalTitle}`, emoji: true },
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
      ...(approvalStage ? [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Your approval role:* ${approvalStage.label}\n*Approval route:* ${approvalRoute || 'Manager approval'}${approvalHistory ? `\n\n*Earlier approvals:*\n${approvalHistory}` : ''}`,
        },
      }] : []),
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

module.exports = {
  registerLeaveHandlers,
  __testables: { processedDecisionBlocks },
};
