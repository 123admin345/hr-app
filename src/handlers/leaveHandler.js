const { buildLeaveRequestModal, buildMaternityLeaveRequestModal, buildConfirmationModal, buildLeaveLoadingModal } = require('../modals/leaveRequestModal');
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
  stageRecord,
  approvalTrailText,
} = require('../utils/leaveApprovalWorkflow');
const {
  maternityLeavePeriod,
  validateMaternityDeliveryDate,
  hasMaternityDateConflict,
  leaveDurationLabel,
  isMaternityEligible,
} = require('../utils/maternityLeave');

const FINAL_ACKNOWLEDGER_SLACK_ID = process.env.FINAL_ACKNOWLEDGER_SLACK_ID || '';
const MATERNITY_NOT_ELIGIBLE = 'Maternity leave is not enabled for your employee record. Please contact HR if your eligibility needs to be corrected. No maternity request has been submitted or approved.';

// Consume the short-lived Slack trigger before looking up employee eligibility.
async function openEmployeeLeaveModal({ client, triggerId, slackUserId }) {
  const opened = await client.views.open({ trigger_id: triggerId, view: buildLeaveLoadingModal() });
  await updateEmployeeLeaveView({ client, viewId: opened.view.id, hash: opened.view.hash, slackUserId });
}

async function updateEmployeeLeaveView({ client, viewId, hash, slackUserId, prefill = {}, preferMaternity = false }) {
  let employee;
  try {
    employee = await getEmployeeBySlackId(slackUserId);
  } catch (error) {
    await client.views.update({ view_id: viewId, hash, view: buildLeaveLoadingModal({ unavailableMessage: 'Your employee record could not be loaded. Close this form and try /request-leave again or contact HR. Nothing has been submitted.' }) });
    throw error;
  }
  if (!employee) {
    await client.views.update({ view_id: viewId, hash, view: buildLeaveLoadingModal({ unavailableMessage: 'Your Slack account is not registered in the HR system. Close this form and contact HR.' }) });
    return;
  }
  const options = { maternityEligible: isMaternityEligible(employee) };
  await client.views.update({ view_id: viewId, hash, view: preferMaternity && options.maternityEligible
    ? buildMaternityLeaveRequestModal(prefill, options)
    : buildLeaveRequestModal(prefill, options) });
  if (preferMaternity && !options.maternityEligible) {
    await client.chat.postMessage({ channel: slackUserId, text: MATERNITY_NOT_ELIGIBLE });
  }
}

// Employee Balances column R determines who receives the final acknowledgement.
// It is per employee, so different companies can use different recipients.
function finalAcknowledgerSlackIdFor(employee = {}) {
  return employee.finalAcknowledgerSlackId || FINAL_ACKNOWLEDGER_SLACK_ID;
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
const processingMaternitySubmissions = new Set();

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
        : /Pending (Department Head|Final Acknowledgement)/.test(details.status) || details.status === 'Approved' ? '✅'
          : 'ℹ️';
  await client.chat.update({
    channel,
    ts,
    text: `${icon} Leave ${details.status.toLowerCase()} — ${details.employeeName}`,
    blocks: processedDecisionBlocks(details),
  });
}

async function _notifyLeaveApprover({ client, employee, request, notes = '', attachmentText = '' }) {
  if (request.leaveType === 'Maternity' && !isMaternityEligible(employee)) throw new Error(MATERNITY_NOT_ELIGIBLE);
  const finalAcknowledgerSlackId = finalAcknowledgerSlackIdFor(employee);
  const stage = getStageForLeaveRequest(request, employee, finalAcknowledgerSlackId);
  if (!stage) throw new Error(`This leave request is not waiting for an approval stage. Current status: ${request.status}.`);
  const approverId = getApproverIdForStage(stage, employee, finalAcknowledgerSlackId);
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
    deliveryDate: request.deliveryDate,
    returnDate: request.returnDate,
  });
}

async function completeFinalLeaveStep({ client, employee, request, finalActorId, finalActionType }) {
  // Leave is counted only after every required approval is complete and the
  // final acknowledgement has been recorded where that route requires it.
  if (request.leaveType === 'Annual') {
    await updateEmployeeBalances(employee.rowIndex, {
      annualUsed: employee.annualUsed + request.totalDays,
      annualRemaining: employee.annualRemaining - request.totalDays,
    });
  } else if (request.leaveType === 'Sick') {
    await updateEmployeeBalance(employee.rowIndex, 'sickUsed', employee.sickUsed + request.totalDays);
  } else if (request.leaveType === 'Hajj') {
    await updateEmployeeBalance(employee.rowIndex, 'hajjUsed', 1);
  } else if (request.leaveType === 'Maternity') {
    if (!isMaternityEligible(employee)) throw new Error(MATERNITY_NOT_ELIGIBLE);
    const period = maternityLeavePeriod(request.deliveryDate || request.startDate);
    if (period.startDate !== request.startDate || period.endDate !== request.endDate
      || period.totalDays !== Number(request.totalDays)
      || !request.attachmentUrls || request.attachmentUrls === 'PENDING_UPLOAD') {
      throw new Error('Maternity dates or delivery proof are missing or inconsistent. HR must verify this request.');
    }
    const recordedDays = Number(employee.maternityUsed || 0);
    if (!Number.isFinite(recordedDays) || recordedDays < 0) throw new Error('The maternity tracking column needs HR review.');
    await updateEmployeeBalance(employee.rowIndex, 'maternityUsed', recordedDays + request.totalDays);
  }

  const completedRequest = await updateLeaveRequestApprovalData(request.requestId, { status: 'Approved' });
  const acknowledged = finalActionType === 'acknowledgement';
  const finalText = acknowledged ? 'confirmed after final acknowledgement' : 'approved';
  const maternitySummary = request.leaveType === 'Maternity'
    ? `\n\n*Delivery date:* ${formatDate(request.deliveryDate || request.startDate)}\n*Calendar return date:* ${formatDate(request.returnDate || maternityLeavePeriod(request.startDate).returnDate)}\nThree calendar months are recorded separately as maternity leave; your annual balance is unchanged. If the return date is a non-working day, confirm your first scheduled working day with HR.`
    : '';

  await client.chat.postMessage({
    channel: request.slackUserId,
    text: `🎉 Your ${request.leaveType} Leave has been ${finalText}!`,
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `🎉 *Your ${request.leaveType} Leave has been ${finalText}!*\n\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${leaveDurationLabel(request.leaveType, request.totalDays)})*${maternitySummary}\n\n${acknowledged ? 'All required approvals are complete and the final acknowledgement has been recorded.' : 'Your manager has approved the request.'}\n\nEnjoy your time off! 🌟`,
      },
    }],
  });

  const hrChannelId = process.env.HR_CHANNEL_ID;
  if (hrChannelId) {
    const leaveEmoji = request.leaveType === 'Annual' ? '🏖️' : request.leaveType === 'Sick' ? '🤒' : request.leaveType === 'Maternity' ? '' : '🕌';
    const finalStepLine = acknowledged
      ? `*Final acknowledgement by:* <@${finalActorId}>`
      : `*Approved by:* <@${finalActorId}>`;
    await client.chat.postMessage({
      channel: hrChannelId,
      text: `${leaveEmoji} Leave ${acknowledged ? 'Confirmed' : 'Approved'} — ${request.employeeName}`,
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${leaveEmoji} *Leave ${acknowledged ? 'Confirmed' : 'Approved'}*\n\n*Employee:* <@${request.slackUserId}> (${request.employeeName})\n*Leave Type:* ${request.leaveType} Leave\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${leaveDurationLabel(request.leaveType, request.totalDays)})*${maternitySummary}\n${finalStepLine}`,
        },
      }],
    });
  }
  return completedRequest;
}

/**
 * Registers all leave-related handlers on the Bolt app.
 */
function registerLeaveHandlers(app) {

  // Switch the form immediately when the employee chooses Maternity. Only the
  // delivery date is entered; the end date is calculated, not manually selected.
  app.action('leave_type_select', async ({ ack, body, action, client, logger }) => {
    await ack();
    const leaveType = action.selected_option?.value;
    if (leaveType !== 'Maternity' && body.view?.callback_id !== 'maternity_leave_review') return;
    if (!body.view?.id) return;
    const values = body.view.state?.values || {};
    const notes = values.notes_block?.notes_input?.value || '';
    try {
      await updateEmployeeLeaveView({
        client, viewId: body.view.id, hash: body.view.hash, slackUserId: body.user.id,
        prefill: { notes, leaveType: leaveType === 'Maternity' ? undefined : leaveType }, preferMaternity: leaveType === 'Maternity',
      });
    } catch (error) {
      logger.error('Unable to change leave form:', error);
      await client.chat.postMessage({ channel: body.user.id, text: 'The leave form could not be updated. Close it and run /request-leave again. Nothing has been submitted.' });
    }
  });

  app.view('maternity_leave_review', async ({ ack, view, body, client, logger }) => {
    const values = view.state?.values || {};
    const deliveryDate = values.delivery_date_block?.delivery_date_pick?.selected_date;
    const notes = values.notes_block?.notes_input?.value || '';
    const dateError = validateMaternityDeliveryDate(deliveryDate, saudiTodayDateString());
    if (dateError) return ack({ response_action: 'errors', errors: { delivery_date_block: dateError } });
    const period = maternityLeavePeriod(deliveryDate);
    await ack({ response_action: 'update', view: buildLeaveLoadingModal() });
    try {
      const employee = await getEmployeeBySlackId(body.user.id);
      const allowed = isMaternityEligible(employee);
      await client.views.update({ view_id: view.id, view: allowed
        ? buildConfirmationModal({ leaveType: 'Maternity', ...period, deliveryDate, notes })
        : buildLeaveLoadingModal({ unavailableMessage: MATERNITY_NOT_ELIGIBLE }) });
    } catch (error) {
      logger.error('Unable to review maternity eligibility:', error);
      await client.views.update({ view_id: view.id, view: buildLeaveLoadingModal({ unavailableMessage: 'Your eligibility could not be checked. Close the form and try again or contact HR. Nothing has been submitted.' }) }).catch(() => {});
    }
  });

  // ─── /request-leave command ────────────────────────────────────────────────
  app.command('/request-leave', async ({ command, ack, client, logger }) => {
    await ack();
    try {
      await openEmployeeLeaveModal({ client, triggerId: command.trigger_id, slackUserId: command.user_id });
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

      const employeeMessage = `🚫 *Your ${request.leaveType} Leave has been cancelled.*\n\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${leaveDurationLabel(request.leaveType, request.totalDays)})*\n\n${cancellationSummaryForEmployee(request, restoredBalances)}\n\nYour manager and HR have been notified.${reason ? `\n\n*Your reason:*\n> ${reason}` : ''}`;
      const managerMessage = `🚫 *Leave Cancelled by Employee*\n\n*Employee:* <@${employeeSlackId}> (${employee.name})\n*Leave Type:* ${request.leaveType} Leave\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${leaveDurationLabel(request.leaveType, request.totalDays)})*\n\nThe leave had not started. The app has updated the leave record and related balance. No manager action is needed.${reason ? `\n\n*Employee reason:*\n> ${reason}` : ''}`;
      const hrChannelId = process.env.HR_CHANNEL_ID;
      const hrMessage = `🚫 *Leave Cancelled by Employee*\n\n*Employee:* <@${employeeSlackId}> (${employee.name})\n*Leave Type:* ${request.leaveType} Leave\n*Dates:* ${formatDate(request.startDate)} → ${formatDate(request.endDate)} *(${leaveDurationLabel(request.leaveType, request.totalDays)})*\n*Balance update:* ${restoredBalances.summary}\n\nThe leave was cancelled before it started. No HR action is required unless further changes are needed.${reason ? `\n\n*Employee reason:*\n> ${reason}` : ''}`;
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
    if (leaveType === 'Maternity') {
      await ack({ response_action: 'update', view: buildLeaveLoadingModal() });
      try {
        await updateEmployeeLeaveView({ client, viewId: view.id, slackUserId, prefill: { notes }, preferMaternity: true });
      } catch (error) {
        logger.error('Unable to check maternity eligibility from the old leave form:', error);
      }
      return;
    }
    if (leaveType && !['Annual', 'Sick', 'Hajj'].includes(leaveType)) errors.leave_type_block = 'Please select a supported leave type.';
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
    await ack({ response_action: 'clear' });
    const slackUserId = body.user.id;
    // Data comes from private_metadata set in the confirmation modal
    let maternitySubmissionClaimed = false;

    try {
      let { leaveType, startDate, endDate, notes = '', deliveryDate = '', returnDate = '' } = JSON.parse(view.private_metadata || '{}');
      if (!['Annual', 'Sick', 'Hajj', 'Maternity'].includes(leaveType)) throw new Error('Unsupported leave type.');
      if (leaveType === 'Maternity') {
        if (processingMaternitySubmissions.has(slackUserId)) return;
        processingMaternitySubmissions.add(slackUserId);
        maternitySubmissionClaimed = true;
        const dateError = validateMaternityDeliveryDate(deliveryDate, saudiTodayDateString());
        if (dateError) {
          await client.chat.postMessage({ channel: slackUserId, text: dateError });
          return;
        }
        ({ startDate, endDate, returnDate } = maternityLeavePeriod(deliveryDate));
      }
      const employee = await getEmployeeBySlackId(slackUserId);
      if (!employee) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: '⚠️ Your Slack account is not registered in the HR system. Please contact HR to be added.',
        });
        return;
      }

      if (leaveType === 'Maternity' && !isMaternityEligible(employee)) {
        await client.chat.postMessage({ channel: slackUserId, text: MATERNITY_NOT_ELIGIBLE });
        return;
      }

      // Validate a configured multi-level route before saving any leave record.
      // Normal employees continue with their existing single-manager route.
      try {
        getLeaveApprovalStages(employee, finalAcknowledgerSlackIdFor(employee));
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
      const totalDays = leaveType === 'Maternity' ? maternityLeavePeriod(deliveryDate).totalDays : countWorkingDays(startDate, endDate);
      if (leaveType === 'Annual' && totalDays > employee.annualRemaining) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: `⚠️ You only have *${employee.annualRemaining} days* of annual leave remaining, but you requested *${totalDays} days*. Please adjust your dates.`,
        });
        return;
      }

      if (leaveType !== 'Annual') {
        const existingRequests = await getLeaveRequestsBySlackId(slackUserId);
        if (leaveType === 'Maternity' && hasMaternityDateConflict(existingRequests, deliveryDate)) {
          await client.chat.postMessage({ channel: slackUserId, text: 'A maternity request for this delivery date is already recorded. Do not submit another request for the same birth. If it is waiting for proof, upload the document here; otherwise contact HR to check the existing request.' });
          return;
        }
        if (existingRequests.some((request) => request.status === 'Pending Documents' || request.status === 'Document Processing')) {
          await client.chat.postMessage({ channel: slackUserId, text: 'You already have a leave request waiting for documents. Please complete that private upload first, or ask HR to resolve it before submitting another documented leave request.' });
          return;
        }
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
          notes,
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
                text: `✅ *Your Annual Leave request has been submitted!*\n\n*Approval route:* ${approvalRouteText(employee)}\n\nYour first approver has been notified and will review it shortly. You will receive a message here once a decision is made.\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${leaveDurationLabel(leaveType, totalDays)})*`,
              },
            },
          ],
        });
        return;
      }

      // ══════════════════════════════════════════════════════════════════════
      //  SICK / HAJJ / MATERNITY — upload supporting proof in the private DM
      // ══════════════════════════════════════════════════════════════════════
      pendingAttachments.set(slackUserId, {
        requestId,
        leaveType,
        employee,
        employeeName: employee.name,
        startDate,
        endDate,
        totalDays,
        deliveryDate,
        returnDate,
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
        deliveryDate,
        returnDate,
        notes,
      });

      // Build the DM prompt based on leave type
      const isSick = leaveType === 'Sick';
      const dmText = leaveType === 'Maternity'
        ? `*Maternity Leave — Delivery-Date Proof Required*\n\n*Delivery date / leave starts:* ${formatDate(deliveryDate)}\n*Last day of leave:* ${formatDate(endDate)}\n*Calendar return date:* ${formatDate(returnDate)}\n*Duration:* Three calendar months (${totalDays} calendar days, including weekends and holidays).\n\nPlease upload a hospital delivery certificate, birth notification, or official document that clearly shows the actual delivery date *here in this private HR System chat*. Use a PDF or clear image; do not post it in a public channel. The document must support the date you entered. Only provide the details needed to confirm the delivery date.\n\nThe request is saved as *Pending Documents*. It will be forwarded along your configured leave route after the file is received. The app checks that a file was submitted; the assigned reviewer must verify its contents and date. This leave is separate from your annual balance.`
        : isSick
        ? `🤒 *Sick Leave Request — Documents Required*\n\nYour request for *${formatDate(startDate)} → ${formatDate(endDate)}* (${leaveDurationLabel(leaveType, totalDays)}) has been saved.\n\nTo complete your request, please send the following files *here in this chat*:\n\n*1.* Screenshot of your *Sehhaty (صحتي)* app showing the sick leave\n*2.* Your *hospital report* confirming the absence\n\nSimply send the files as messages in this chat — no links needed. Once I receive them, your request will be forwarded to your manager automatically. 📎`
        : `🕌 *Hajj Leave Request — Document Required*\n\nYour request for *${formatDate(startDate)} → ${formatDate(endDate)}* (${leaveDurationLabel(leaveType, totalDays)}) has been saved.\n\nTo complete your request, please send your *official Hajj permission document* from the government *here in this chat*.\n\nSimply send the file as a message — no links needed. Once I receive it, your manager will be notified automatically. 📎`;

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
                text: 'Upload documents only in this private HR System conversation. Stored links are restricted by Slack file permissions and the HR Sheet permissions; do not share them publicly. Contact HR if an assigned reviewer cannot open the file.',
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
    } finally {
      if (maternitySubmissionClaimed) processingMaternitySubmissions.delete(slackUserId);
    }
  });

  // ─── Listen for private supporting documents for recorded leave requests ──
  app.event('message', async ({ event, client, logger }) => {
    let documentRequestId;
    let documentClaimed = false;
    let documentSaved = false;
    try {
      // Only handle DMs (channel_type: 'im') that contain file attachments
      if (event.channel_type !== 'im') return;
      if (!event.files || event.files.length === 0) return;
      if (event.subtype === 'bot_message' || event.bot_id || !event.user) return;

      const slackUserId = event.user;
      let pending = pendingAttachments.get(slackUserId);
      if (!pending) {
        // A Render restart must not lose a maternity request waiting for proof.
        // Read only this employee's saved Pending Documents request.
        const requests = await getLeaveRequestsBySlackId(slackUserId);
        const waiting = requests.filter((request) => request.status === 'Pending Documents'
          && ['Sick', 'Hajj', 'Maternity'].includes(request.leaveType));
        if (!waiting.length) return;
        if (waiting.length > 1) {
          await client.chat.postMessage({ channel: slackUserId, text: 'More than one leave request is waiting for documents. Please contact HR so the correct request can be selected. Your file has not been assigned to a request.' });
          return;
        }
        const employee = await getEmployeeBySlackId(slackUserId);
        if (!employee) return;
        pending = { ...waiting[0], employee, notes: waiting[0].managerNotes };
      }

      const {
        requestId, leaveType, employee, employeeName,
        startDate, endDate, totalDays, notes, deliveryDate, returnDate,
      } = pending;
      documentRequestId = requestId;
      const routingEmployee = leaveType === 'Maternity'
        ? await getEmployeeBySlackId(slackUserId) : employee;
      if (leaveType === 'Maternity' && !isMaternityEligible(routingEmployee)) {
        await client.chat.postMessage({ channel: slackUserId, text: 'Maternity eligibility is not enabled in your current employee record. Your existing request remains on hold; contact HR before proceeding. This document has not been forwarded for approval.' });
        return;
      }

      if (leaveType === 'Maternity' && !event.files.some((file) => (
        file.mimetype === 'application/pdf' || /^image\//.test(file.mimetype || '')
        || ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'heif'].includes(file.filetype)
      ))) {
        await client.chat.postMessage({ channel: slackUserId, text: 'Please send your delivery-date proof as a PDF or clear image in this private chat. No approval request has been sent yet.' });
        return;
      }

      // Collect all uploaded file permalinks
      const fileLinks = event.files
        .filter((file) => file.permalink && (leaveType !== 'Maternity' || file.mimetype === 'application/pdf'
          || /^image\//.test(file.mimetype || '') || ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'heif'].includes(file.filetype)))
        .map((f) => `<${f.permalink}|${f.name}>`)
        .join('\n');
      if (!fileLinks) {
        await client.chat.postMessage({ channel: slackUserId, text: 'The file link was not available. Please upload the delivery/supporting document again as a PDF or image, or contact HR.' });
        return;
      }
      const claim = await claimLeaveRequestDecision(requestId, 'Document Processing', 'Pending Documents');
      if (!claim.claimed) {
        pendingAttachments.delete(slackUserId);
        return;
      }
      documentClaimed = true;

      // Update the Google Sheet with the real attachment URLs
      await updateLeaveRequestAttachments(requestId, fileLinks);
      documentSaved = true;

      // Clear the pending state
      pendingAttachments.delete(slackUserId);

      // Now notify the first configured approver with the full request + file links
      await _notifyLeaveApprover({
        client,
        employee: routingEmployee,
        request: {
          requestId, status: 'Pending', slackUserId, employeeName,
          leaveType, startDate, endDate, totalDays, deliveryDate, returnDate,
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
              text: `✅ *Documents received!*\n\nYour *${leaveType} Leave* request has been forwarded to the first required approver.\n\n*Approval route:* ${approvalRouteText(employee)}\n\n*Dates:* ${formatDate(startDate)} → ${formatDate(endDate)} *(${leaveDurationLabel(leaveType, totalDays)})*\n\nYou will receive a message here once a decision is made.`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error handling file upload:', err);
      if (documentClaimed && !documentSaved) {
        await updateLeaveRequestStatus(documentRequestId, 'Documents Need HR Review', 'The document upload could not be linked automatically. HR must verify the request before approval.').catch(() => {});
      }
      if (documentRequestId) {
        await client.chat.postMessage({ channel: event.user, text: documentSaved
          ? 'Your proof was saved, but the approval notification could not be completed. Please contact HR with the existing request ID; do not submit another maternity request.'
          : 'The supporting document could not be processed. Please contact HR to check the existing leave request before trying again.' }).catch(() => {});
      }
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
      const finalAcknowledgerSlackId = finalAcknowledgerSlackIdFor(employee);
      const stage = getStageForLeaveRequest(pendingRequest, employee, finalAcknowledgerSlackId);
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
      if (stage.actionType === 'acknowledgement') {
        await client.chat.postMessage({
          channel: managerId,
          text: 'This request is waiting for final acknowledgement. Please use the Acknowledge button in the current request message.',
        });
        return;
      }
      const requiredApproverId = getApproverIdForStage(stage, employee, finalAcknowledgerSlackId);
      if (requiredApproverId !== managerId) {
        await client.chat.postMessage({ channel: managerId, text: `⚠️ Only the assigned ${stage.label} can approve this leave request.` });
        return;
      }
      if (pendingRequest.leaveType === 'Maternity' && !isMaternityEligible(employee)) {
        await client.chat.postMessage({ channel: managerId, text: 'This maternity request cannot proceed because HR has not enabled maternity eligibility for this employee. Please ask HR to verify the employee record. No approval has been recorded and no balance has changed.' });
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

      const stages = getLeaveApprovalStages(employee, finalAcknowledgerSlackId);
      const stageIndex = stages.findIndex((item) => item.key === stage.key);
      const nextStage = stages[stageIndex + 1] || null;
      const approvalValue = stageRecord({ actorId: managerId, stageLabel: stage.label, actionType: stage.actionType });
      const approvedRequest = await updateLeaveRequestApprovalData(requestId, {
        ...(nextStage ? { status: stage.completedStatus } : {}),
        [stage.recordField]: approvalValue,
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
          text: `✅ Your ${request.leaveType} Leave request was approved by your ${stage.label} and has been sent for ${nextStage.actionType === 'acknowledgement' ? 'final acknowledgement' : 'the next approval'}.`,
        });
        await replaceManagerDecisionMessage(client, body, {
          status: stage.completedStatus,
          leaveType: request.leaveType,
          slackUserId: request.slackUserId,
          employeeName: request.employeeName,
          startDate: request.startDate,
          endDate: request.endDate,
          totalDays: request.totalDays,
          managerId,
          approvalHistory: approvalTrailText(approvedRequest),
          nextStageLabel: nextStage.label,
          nextStageActionType: nextStage.actionType,
        });
        return;
      }

      const finalRequest = await completeFinalLeaveStep({
        client,
        employee,
        request: approvedRequest,
        finalActorId: managerId,
        finalActionType: stage.actionType,
      });
      approvalSaved = true;

      // Replace the original buttons with the final decision so no second action is needed.
      await replaceManagerDecisionMessage(client, body, {
        status: 'Approved', leaveType: request.leaveType, slackUserId: request.slackUserId, employeeName: request.employeeName,
        startDate: request.startDate, endDate: request.endDate, totalDays: request.totalDays, managerId,
        approvalHistory: approvalTrailText(finalRequest),
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

  // ─── Final acknowledgement button ─────────────────────────────────────────
  // This is intentionally not an approval or rejection. It records that the
  // final person has seen the request after all required approvals are complete.
  app.action('acknowledge_leave', async ({ ack, body, action, client, logger }) => {
    await ack();
    const acknowledgerId = body.user.id;
    const { requestId } = JSON.parse(action.value);
    let decisionClaimed = false;
    let acknowledgementSaved = false;

    try {
      if (processingLeaveDecisions.has(requestId)) return;
      processingLeaveDecisions.add(requestId);
      const pendingRequest = await getLeaveRequestById(requestId);
      if (!pendingRequest) throw new Error('This leave request could not be found.');
      const employee = await getEmployeeBySlackId(pendingRequest.slackUserId);
      if (!employee) throw new Error('The employee for this leave request could not be found.');
      const finalAcknowledgerSlackId = finalAcknowledgerSlackIdFor(employee);
      const stage = getStageForLeaveRequest(pendingRequest, employee, finalAcknowledgerSlackId);

      if (!stage || stage.actionType !== 'acknowledgement') {
        if (pendingRequest) {
          await replaceManagerDecisionMessage(client, body, {
            status: pendingRequest.status,
            leaveType: pendingRequest.leaveType,
            slackUserId: pendingRequest.slackUserId,
            employeeName: pendingRequest.employeeName,
            startDate: pendingRequest.startDate,
            endDate: pendingRequest.endDate,
            totalDays: pendingRequest.totalDays,
            managerId: acknowledgerId,
            approvalHistory: approvalTrailText(pendingRequest),
          });
        }
        return;
      }
      if (getApproverIdForStage(stage, employee, finalAcknowledgerSlackId) !== acknowledgerId) {
        await client.chat.postMessage({ channel: acknowledgerId, text: '⚠️ Only the assigned Final Acknowledger can acknowledge this leave request.' });
        return;
      }
      if (pendingRequest.leaveType === 'Maternity' && !isMaternityEligible(employee)) {
        await client.chat.postMessage({ channel: acknowledgerId, text: 'This maternity request cannot be confirmed because HR has not enabled maternity eligibility for this employee. Please ask HR to verify the employee record. No acknowledgement has been recorded and no balance has changed.' });
        return;
      }

      const claim = await claimLeaveRequestDecision(requestId, stage.processingStatus, stage.pendingStatus);
      if (!claim.claimed) return;
      decisionClaimed = true;
      const request = claim.request;

      try {
        await replaceManagerDecisionMessage(client, body, {
          status: stage.processingStatus,
          leaveType: request.leaveType,
          slackUserId: request.slackUserId,
          employeeName: request.employeeName,
          startDate: request.startDate,
          endDate: request.endDate,
          totalDays: request.totalDays,
          managerId: acknowledgerId,
          approvalHistory: approvalTrailText(request),
          finalActionType: 'acknowledgement',
        });
      } catch (messageError) {
        logger.error('Unable to replace acknowledgement button while processing leave:', messageError);
      }

      const acknowledgedRequest = await updateLeaveRequestApprovalData(requestId, {
        [stage.recordField]: stageRecord({
          actorId: acknowledgerId,
          stageLabel: stage.label,
          actionType: 'acknowledgement',
        }),
      });
      const finalRequest = await completeFinalLeaveStep({
        client,
        employee,
        request: acknowledgedRequest,
        finalActorId: acknowledgerId,
        finalActionType: 'acknowledgement',
      });
      acknowledgementSaved = true;

      await replaceManagerDecisionMessage(client, body, {
        status: 'Approved',
        leaveType: request.leaveType,
        slackUserId: request.slackUserId,
        employeeName: request.employeeName,
        startDate: request.startDate,
        endDate: request.endDate,
        totalDays: request.totalDays,
        managerId: acknowledgerId,
        approvalHistory: approvalTrailText(finalRequest),
        finalActionType: 'acknowledgement',
      });
    } catch (err) {
      logger.error('Error recording final leave acknowledgement:', err);
      if (decisionClaimed && !acknowledgementSaved) {
        try {
          await updateLeaveRequestStatus(requestId, 'Acknowledgement Needs HR Review', 'Final acknowledgement could not be completed automatically. HR must verify the leave record and balance before taking action.');
        } catch (recoveryError) {
          logger.error('Unable to record failed leave acknowledgement for HR review:', recoveryError);
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
      const stage = employee ? getStageForLeaveRequest(existingRequest, employee, finalAcknowledgerSlackIdFor(employee)) : null;
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
      if (stage.actionType !== 'approval') {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'This final step is acknowledgement only. It cannot approve or reject the leave request. Please use the Acknowledge button.',
        });
        return;
      }
      if (getApproverIdForStage(stage, employee, finalAcknowledgerSlackIdFor(employee)) !== body.user.id) {
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
      const stage = getStageForLeaveRequest(pendingRequest, employee, finalAcknowledgerSlackIdFor(employee));
      if (!stage) throw new Error('This leave request is no longer awaiting approval.');
      if (stage.actionType !== 'approval') throw new Error('This final step is acknowledgement only and cannot be rejected.');
      if (getApproverIdForStage(stage, employee, finalAcknowledgerSlackIdFor(employee)) !== managerId) {
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
        [stage.recordField]: rejectedRecord,
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
              text: `❌ *Your ${existingRequest.leaveType} Leave request was not approved.*\n\n*Dates:* ${formatDate(existingRequest.startDate)} → ${formatDate(existingRequest.endDate)} *(${leaveDurationLabel(existingRequest.leaveType, existingRequest.totalDays)})*\n\n*Decision level:* ${stage.label}\n*Reason:*\n> ${reason}\n\nIf you have questions, please reach out to your manager directly.`,
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

// ─── Helper: send the full leave request to the current action owner ─────────
async function _notifyManager({
  client, managerId, slackUserId, employeeName, leaveType,
  startDate, endDate, totalDays, notes, attachmentText,
  annualRemaining, requestId, approvalStage, approvalHistory = '', approvalRoute = '', deliveryDate = '', returnDate = '',
}) {
  const leaveEmoji = leaveType === 'Annual' ? '🏖️' : leaveType === 'Sick' ? '🤒' : leaveType === 'Maternity' ? '' : '🕌';
  const acknowledgementOnly = approvalStage?.actionType === 'acknowledgement';
  const actionTitle = acknowledgementOnly
    ? 'Leave Acknowledgement Required'
    : approvalStage?.key === 'final_manager'
      ? 'Leave Approval Required'
      : `Leave Approval Required — ${approvalStage?.label || 'Manager'}`;
  const actionRoleText = acknowledgementOnly
    ? 'Final Acknowledger'
    : approvalStage?.label || 'Manager';
  const actionInstruction = acknowledgementOnly
    ? 'The required approval step(s) are complete. Please acknowledge this leave request. This is acknowledgement only: there is no Approve or Reject action at this stage.'
    : 'Please review the request and choose Approve or Reject.';

  const hajjNote = leaveType === 'Hajj'
    ? '\n\n> ℹ️ *Hajj Leave* is a legal entitlement (10 days). This notification is for your awareness — this leave will *not* be deducted from the employee\'s annual balance.'
    : '';
  const sickNote = leaveType === 'Sick'
    ? '\n\n> ℹ️ *Sick Leave* — HR will review the attached documents. If the report does not confirm a medical absence, the days will be deducted from the employee\'s annual balance.'
    : '';
  const maternityNote = leaveType === 'Maternity'
    ? `*Maternity Leave — company rule:* Three calendar months from the actual delivery date, including weekends and holidays. Not deducted from annual leave.\n*Delivery date:* ${formatDate(deliveryDate || startDate)}\n*Calendar return date:* ${formatDate(returnDate || maternityLeavePeriod(startDate).returnDate)}\n${acknowledgementOnly ? 'Delivery-date proof was submitted with the request. The earlier required approval(s) are recorded above.' : 'Verify that the attached official document confirms the delivery date entered. Receiving a file is not automatic verification of its contents. Ask HR to correct any mismatch or handle pre-delivery leave and statutory extensions.'}`
    : '';

  // The server reads the current request from Google Sheets. The button only
  // carries its request ID so earlier steps cannot be bypassed with stale data.
  const buttonValue = JSON.stringify({ requestId });
  const actionElements = acknowledgementOnly
    ? [{
      type: 'button',
      text: { type: 'plain_text', text: '✅ Acknowledge', emoji: true },
      style: 'primary',
      action_id: 'acknowledge_leave',
      value: buttonValue,
    }]
    : [
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
    ];

  await client.chat.postMessage({
    channel: managerId,
    text: `${leaveEmoji} ${actionTitle} — ${employeeName}`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${leaveEmoji} ${actionTitle}`, emoji: true },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Employee:*\n<@${slackUserId}>` },
          { type: 'mrkdwn', text: `*Leave Type:*\n${leaveType} Leave` },
          { type: 'mrkdwn', text: `*From:*\n${formatDate(startDate)}` },
          { type: 'mrkdwn', text: `*To:*\n${formatDate(endDate)}` },
          { type: 'mrkdwn', text: `*${leaveType === 'Maternity' ? 'Calendar Days' : 'Working Days'}:*\n${totalDays} day(s)` },
          { type: 'mrkdwn', text: `*Annual Balance Left:*\n${annualRemaining} day(s)` },
        ],
      },
      ...(approvalStage ? [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Your role:* ${actionRoleText}\n*Approval route:* ${approvalRoute || 'Manager approval'}${approvalHistory ? `\n\n*Earlier approvals:*\n${approvalHistory}` : ''}\n\n${actionInstruction}`,
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
      ...((hajjNote || sickNote || maternityNote) ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: (hajjNote || sickNote || maternityNote).trim() },
      }] : []),
      { type: 'divider' },
      {
        type: 'actions',
        block_id: acknowledgementOnly ? 'acknowledgement_actions' : 'approval_actions',
        elements: actionElements,
      },
    ],
  });
}

module.exports = {
  registerLeaveHandlers,
  openEmployeeLeaveModal,
  __testables: { processedDecisionBlocks },
};
