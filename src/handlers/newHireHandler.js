const {
  getEmployeeBySlackId,
  getCompanyBusinessApprover,
  addNewHireRequest,
  getNewHireRequestById,
  updateNewHireRequest,
  claimNewHireRequestDecision,
} = require('../utils/sheets');
const { generateRequestId } = require('../utils/dates');
const {
  buildNewHireRequestModal,
  buildNewHireConfirmationModal,
  buildNewHireRejectionModal,
} = require('../modals/newHireRequestModal');
const {
  newHireHrApproverIds,
  newHireFinanceApproverIds,
  isNewHireRequester,
  isAuthorisedForNewHireStage,
  stageForNewHireRequest,
  nextStageFor,
  approvalRecord,
  newHireApprovalBlocks,
  newHireFinalStatusBlocks,
  requesterStatusText,
  validateNewHireRequestForm,
} = require('../utils/newHireRequest');

const processingNewHireDecisions = new Set();

function modalValue(view, blockId, actionId) {
  return view.state.values[blockId]?.[actionId];
}

function readNewHireRequestForm(view) {
  return {
    company: modalValue(view, 'company_block', 'company_input')?.value?.trim() || '',
    department: modalValue(view, 'department_block', 'department_input')?.value?.trim() || '',
    jobTitle: modalValue(view, 'job_title_block', 'job_title_input')?.value?.trim() || '',
    requestType: modalValue(view, 'request_type_block', 'request_type_select')?.selected_option?.value || '',
    employmentType: modalValue(view, 'employment_type_block', 'employment_type_select')?.selected_option?.value || '',
    proposedCandidateName: modalValue(view, 'candidate_name_block', 'candidate_name_input')?.value?.trim() || '',
    targetStartDate: modalValue(view, 'target_start_block', 'target_start_pick')?.selected_date || '',
    businessJustification: modalValue(view, 'business_justification_block', 'business_justification_input')?.value?.trim() || '',
    replacementEmployeeName: modalValue(view, 'replacement_employee_block', 'replacement_employee_input')?.value?.trim() || '',
    budgetSalaryRange: modalValue(view, 'budget_range_block', 'budget_range_input')?.value?.trim() || '',
    jobRequirements: modalValue(view, 'job_requirements_block', 'job_requirements_input')?.value?.trim() || '',
  };
}

function messageLocation(body) {
  return {
    channel: body.channel?.id || body.container?.channel_id,
    ts: body.message?.ts || body.container?.message_ts,
  };
}

async function replaceApprovalMessage(client, body, request) {
  const { channel, ts } = messageLocation(body);
  if (!channel || !ts) return;
  await client.chat.update({
    channel,
    ts,
    text: `New-hire request — ${request.status}`,
    // A decision message must never regain action buttons. The next approver
    // receives a newly-created private message with their own buttons.
    blocks: newHireFinalStatusBlocks(request),
  });
}

function hrQueueChannelId() {
  return process.env.NEW_HIRE_HR_CHANNEL_ID || process.env.HR_CHANNEL_ID || '';
}

async function postNewHireApprovalRequest(client, request) {
  const stage = stageForNewHireRequest(request);
  if (!stage) return;

  const text = `New-hire request — ${stage.label} review required`;
  const blocks = newHireApprovalBlocks(request);
  if (stage.key === 'hr') {
    const channel = hrQueueChannelId();
    if (!channel) throw new Error('NEW_HIRE_HR_CHANNEL_ID or HR_CHANNEL_ID must be configured for the HR review queue.');
    await client.chat.postMessage({ channel, text, blocks });
    return;
  }

  const recipients = stage.key === 'finance'
    ? newHireFinanceApproverIds()
    : [request.businessApproverSlackId].filter(Boolean);
  if (!recipients.length) {
    throw new Error(`No authorised ${stage.label} recipient is configured for this request.`);
  }
  await Promise.all(recipients.map((channel) => client.chat.postMessage({ channel, text, blocks })));
}

async function informRequesterRequestSubmitted(client, request) {
  await client.chat.postMessage({
    channel: request.requesterSlackId,
    text: `✅ *Your new-hire request has been sent to HR for review.*\n\n*Role:* ${request.jobTitle}\n*Company:* ${request.company}\n*Department:* ${request.department}\n*Request ID:* \`${request.requestId}\`\n\nHR will confirm the next step after reviewing the business need, budget information, and role details. Recruitment must not start until the full approval route is complete.`,
  });
}

function decisionDetails(stage, actorId, decision, reason = '') {
  return {
    [stage.recordField]: approvalRecord({ actorId, stageLabel: stage.label, decision, reason }),
    ...(reason ? { rejectionReason: reason } : {}),
  };
}

function registerNewHireHandlers(app) {
  // ─── /request-new-hire ─────────────────────────────────────────────────────
  app.command('/request-new-hire', async ({ command, ack, client, logger }) => {
    await ack();
    try {
      const employee = await getEmployeeBySlackId(command.user_id);
      if (!isNewHireRequester(employee, command.user_id)) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: 'This command is available to managers and authorised hiring requesters only. Please contact HR if you believe you should have access.',
        });
        return;
      }
      await client.views.open({ trigger_id: command.trigger_id, view: buildNewHireRequestModal() });
    } catch (error) {
      logger.error('Error opening new-hire request modal:', error);
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: 'Unable to open the new-hire request form. Please try again or contact HR.',
      });
    }
  });

  // ─── Request review step ───────────────────────────────────────────────────
  app.view('new_hire_request_review', async ({ ack, view, logger }) => {
    const data = readNewHireRequestForm(view);
    const errors = validateNewHireRequestForm(data);
    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }
    try {
      await ack({ response_action: 'push', view: buildNewHireConfirmationModal(data) });
    } catch (error) {
      logger.error('Error reviewing new-hire request:', error);
      await ack({ response_action: 'errors', errors: { company_block: 'Unable to review this request. Please try again.' } });
    }
  });

  // ─── New request submission ────────────────────────────────────────────────
  app.view('new_hire_request_submit', async ({ ack, view, body, client, logger }) => {
    await ack();
    try {
      const requester = await getEmployeeBySlackId(body.user.id);
      if (!isNewHireRequester(requester, body.user.id)) {
        await client.chat.postMessage({ channel: body.user.id, text: 'This new-hire request could not be submitted because your manager/requester access needs HR review.' });
        return;
      }
      const data = JSON.parse(view.private_metadata || '{}');
      const errors = validateNewHireRequestForm(data);
      if (Object.keys(errors).length > 0) throw new Error('The request form is incomplete or no longer valid. Please reopen the request form.');

      const businessApproverSlackId = await getCompanyBusinessApprover(data.company);
      if (!businessApproverSlackId) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: `⚠️ HR has not configured a Business Approver for *${data.company}* yet. Your request was not submitted. Please contact HR to add this company and the correct final approver in the Company Approvers sheet, then submit again.`,
        });
        return;
      }

      const request = {
        requestId: generateRequestId().replace('REQ-', 'NEW-HIRE-'),
        submittedAt: new Date().toISOString(),
        requesterSlackId: body.user.id,
        requesterName: requester.name,
        company: data.company,
        department: data.department,
        jobTitle: data.jobTitle,
        requestType: data.requestType,
        employmentType: data.employmentType,
        proposedCandidateName: data.proposedCandidateName || '',
        targetStartDate: data.targetStartDate || '',
        businessJustification: data.businessJustification,
        replacementEmployeeName: data.replacementEmployeeName || '',
        budgetSalaryRange: data.budgetSalaryRange,
        jobRequirements: data.jobRequirements,
        businessApproverSlackId,
        status: 'Pending HR Approval',
      };

      await addNewHireRequest(request);
      await postNewHireApprovalRequest(client, request);
      await informRequesterRequestSubmitted(client, request);
    } catch (error) {
      logger.error('Error submitting new-hire request:', error);
      await client.chat.postMessage({
        channel: body.user.id,
        text: 'Unable to submit the new-hire request. Please try again or contact HR.',
      });
    }
  });

  // ─── Approve action ────────────────────────────────────────────────────────
  app.action('new_hire_approve', async ({ ack, body, action, client, logger }) => {
    await ack();
    const { requestId } = JSON.parse(action.value || '{}');
    const actorId = body.user.id;
    let claimed = false;
    let completed = false;

    try {
      if (!requestId || processingNewHireDecisions.has(requestId)) return;
      processingNewHireDecisions.add(requestId);
      const current = await getNewHireRequestById(requestId);
      const stage = stageForNewHireRequest(current);
      if (!current || !stage) {
        if (current) await replaceApprovalMessage(client, body, current);
        return;
      }
      if (!isAuthorisedForNewHireStage(actorId, stage, current)) {
        await client.chat.postMessage({ channel: actorId, text: `Only an authorised ${stage.label} reviewer can act on this new-hire request.` });
        return;
      }

      const claim = await claimNewHireRequestDecision(requestId, stage.processingStatus, stage.pendingStatus);
      if (!claim.claimed) {
        if (claim.request) await replaceApprovalMessage(client, body, claim.request);
        return;
      }
      claimed = true;
      await replaceApprovalMessage(client, body, claim.request);

      const nextStage = nextStageFor(stage);
      const updated = await updateNewHireRequest(requestId, {
        ...decisionDetails(stage, actorId, 'Approved'),
        status: stage.approvedStatus,
        rejectionReason: '',
      });
      completed = true;
      await replaceApprovalMessage(client, body, updated);

      if (nextStage) {
        await postNewHireApprovalRequest(client, updated);
        await client.chat.postMessage({
          channel: updated.requesterSlackId,
          text: `Your new-hire request for *${updated.jobTitle}* at *${updated.company}* has passed ${stage.label} review and is now awaiting ${nextStage.label} review.`,
        });
      } else {
        await client.chat.postMessage({ channel: updated.requesterSlackId, text: requesterStatusText(updated) });
        const queue = hrQueueChannelId();
        if (queue) {
          await client.chat.postMessage({
            channel: queue,
            text: `New-hire request approved — ${updated.jobTitle} at ${updated.company}`,
            blocks: newHireFinalStatusBlocks(updated),
          });
        }
      }
    } catch (error) {
      logger.error('Error approving new-hire request:', error);
      if (claimed && !completed) {
        try {
          const needsReview = await updateNewHireRequest(requestId, {
            status: 'Approval Needs HR Review',
            rejectionReason: 'The approval could not be completed automatically. HR must verify the request before taking action.',
          });
          await replaceApprovalMessage(client, body, needsReview);
        } catch (recoveryError) {
          logger.error('Unable to record failed new-hire approval for HR review:', recoveryError);
        }
      }
      await client.chat.postMessage({ channel: actorId, text: 'Unable to complete this approval. Please try again or contact HR.' });
    } finally {
      processingNewHireDecisions.delete(requestId);
    }
  });

  // ─── Reject action → mandatory feedback modal ──────────────────────────────
  app.action('new_hire_reject', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const { requestId } = JSON.parse(action.value || '{}');
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildNewHireRejectionModal({
          requestId,
          channel: messageLocation(body).channel,
          ts: messageLocation(body).ts,
          stageLabel: 'Current review stage',
        }),
      });
    } catch (error) {
      logger.error('Error opening new-hire rejection modal:', error);
    }
  });

  // ─── Rejection feedback submission ─────────────────────────────────────────
  app.view('new_hire_rejection_submit', async ({ ack, view, body, client, logger }) => {
    const metadata = JSON.parse(view.private_metadata || '{}');
    const reason = modalValue(view, 'new_hire_rejection_reason_block', 'new_hire_rejection_reason_input')?.value?.trim() || '';
    if (!reason) {
      await ack({ response_action: 'errors', errors: { new_hire_rejection_reason_block: 'Please provide a reason for rejecting this request.' } });
      return;
    }
    await ack();

    const actorId = body.user.id;
    const { requestId } = metadata;
    let claimed = false;
    let completed = false;
    try {
      if (!requestId || processingNewHireDecisions.has(requestId)) return;
      processingNewHireDecisions.add(requestId);
      const current = await getNewHireRequestById(requestId);
      const stage = stageForNewHireRequest(current);
      if (!current || !stage) {
        if (current) await replaceApprovalMessage(client, { channel: { id: metadata.channel }, message: { ts: metadata.ts } }, current);
        return;
      }
      if (!isAuthorisedForNewHireStage(actorId, stage, current)) {
        await client.chat.postMessage({ channel: actorId, text: `Only an authorised ${stage.label} reviewer can reject this new-hire request.` });
        return;
      }

      const claim = await claimNewHireRequestDecision(requestId, stage.processingStatus, stage.pendingStatus);
      if (!claim.claimed) {
        if (claim.request) await replaceApprovalMessage(client, { channel: { id: metadata.channel }, message: { ts: metadata.ts } }, claim.request);
        return;
      }
      claimed = true;
      await replaceApprovalMessage(client, { channel: { id: metadata.channel }, message: { ts: metadata.ts } }, claim.request);

      const updated = await updateNewHireRequest(requestId, {
        ...decisionDetails(stage, actorId, 'Rejected', reason),
        status: stage.rejectedStatus,
        rejectionReason: reason,
      });
      completed = true;
      await replaceApprovalMessage(client, { channel: { id: metadata.channel }, message: { ts: metadata.ts } }, updated);
      await client.chat.postMessage({ channel: updated.requesterSlackId, text: requesterStatusText(updated) });
    } catch (error) {
      logger.error('Error rejecting new-hire request:', error);
      if (claimed && !completed) {
        try {
          const needsReview = await updateNewHireRequest(requestId, {
            status: 'Approval Needs HR Review',
            rejectionReason: 'The rejection could not be completed automatically. HR must verify the request before taking action.',
          });
          await replaceApprovalMessage(client, { channel: { id: metadata.channel }, message: { ts: metadata.ts } }, needsReview);
        } catch (recoveryError) {
          logger.error('Unable to record failed new-hire rejection for HR review:', recoveryError);
        }
      }
      await client.chat.postMessage({ channel: actorId, text: 'Unable to record this rejection. Please try again or contact HR.' });
    } finally {
      processingNewHireDecisions.delete(requestId);
    }
  });
}

module.exports = {
  registerNewHireHandlers,
  __testables: {
    readNewHireRequestForm,
  },
};
