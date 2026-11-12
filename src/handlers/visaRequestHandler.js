const {
  getEmployeeBySlackId,
  addVisaRequest,
  getVisaRequestById,
  updateVisaRequest,
} = require('../utils/sheets');
const { generateRequestId } = require('../utils/dates');
const {
  buildVisaRequestModal,
  buildVisaRequestConfirmationModal,
  buildVisaIssuedModal,
  buildVisaCannotIssueModal,
} = require('../modals/visaRequestModal');
const {
  calculatePaymentResponsibility,
  isValidVisaRequestForm,
  isValidIssuedVisaFields,
  isVisaHrUser,
  visaQueueBlocks,
  visaFinalStatusBlocks,
  visaEmployeeResultText,
} = require('../utils/visaRequest');

const processingVisaRequests = new Set();

function value(view, blockId, actionId) {
  return view.state.values[blockId]?.[actionId];
}

function readVisaRequestForm(view) {
  return {
    purpose: value(view, 'visa_purpose_block', 'visa_purpose_select')?.selected_option?.value,
    visaType: value(view, 'visa_type_block', 'visa_type_select')?.selected_option?.value,
    requestedDuration: value(view, 'visa_duration_block', 'visa_duration_select')?.selected_option?.value,
    departureDate: value(view, 'departure_date_block', 'departure_date_pick')?.selected_date,
    returnDate: value(view, 'return_date_block', 'return_date_pick')?.selected_date,
    destination: value(view, 'destination_block', 'destination_input')?.value || '',
    employeeNotes: value(view, 'visa_notes_block', 'visa_notes_input')?.value || '',
  };
}

function collectVisaDecisionFields(view, status) {
  const hrNotes = value(view, 'hr_notes_block', 'hr_notes_input')?.value || '';
  const fields = { status, hrNotes };

  if (status === 'Issued') {
    fields.visaReference = value(view, 'visa_reference_block', 'visa_reference_input')?.value || '';
    fields.validFrom = value(view, 'valid_from_block', 'valid_from_pick')?.selected_date || '';
    fields.validUntil = value(view, 'valid_until_block', 'valid_until_pick')?.selected_date || '';
    fields.collectionInstructions = value(view, 'collection_instructions_block', 'collection_instructions_input')?.value || '';
  }

  return fields;
}

async function replaceVisaQueueMessage(client, body, request) {
  const channel = body.channel?.id || body.container?.channel_id;
  const ts = body.message?.ts || body.container?.message_ts;
  if (!channel || !ts) return;
  await client.chat.update({
    channel,
    ts,
    text: `Exit re-entry visa request — ${request.status}`,
    blocks: visaFinalStatusBlocks(request),
  });
}

function registerVisaRequestHandlers(app) {
  // ─── /request-exit-reentry-visa ───────────────────────────────────────────
  app.command('/request-exit-reentry-visa', async ({ command, ack, client, logger }) => {
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
      if (!employee.exitReentryEligible) {
        await client.chat.postMessage({
          channel: command.user_id,
          text: 'This request is available only to foreign employees who are marked as eligible for exit re-entry visas. Please contact HR if you believe your employee record needs updating.',
        });
        return;
      }

      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildVisaRequestModal(),
      });
    } catch (err) {
      logger.error('Error opening exit re-entry visa request:', err);
      await client.chat.postMessage({
        channel: command.user_id,
        text: '❌ Something went wrong while opening the visa request. Please try again or contact HR.',
      });
    }
  });

  // ─── Visa request review ──────────────────────────────────────────────────
  app.view('visa_request_review', async ({ ack, view, logger }) => {
    const data = readVisaRequestForm(view);
    const errors = isValidVisaRequestForm(data);
    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }

    try {
      await ack({ response_action: 'push', view: buildVisaRequestConfirmationModal(data) });
    } catch (err) {
      logger.error('Error reviewing exit re-entry visa request:', err);
      await ack({
        response_action: 'errors',
        errors: { visa_notes_block: 'Something went wrong. Please try again.' },
      });
    }
  });

  // ─── Visa request submission ──────────────────────────────────────────────
  app.view('visa_request_submit', async ({ ack, view, body, client, logger }) => {
    await ack();
    try {
      const employee = await getEmployeeBySlackId(body.user.id);
      const data = JSON.parse(view.private_metadata || '{}');
      if (!employee || !employee.exitReentryEligible) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: '⚠️ This visa request could not be submitted because your employee eligibility record needs HR review.',
        });
        return;
      }

      const request = {
        requestId: generateRequestId().replace('REQ-', 'VISA-'),
        employeeName: employee.name,
        employeeSlackId: body.user.id,
        purpose: data.purpose,
        paymentResponsibility: calculatePaymentResponsibility(data.purpose),
        visaType: data.visaType,
        requestedDuration: data.requestedDuration,
        departureDate: data.departureDate,
        returnDate: data.returnDate,
        destination: data.destination || '',
        employeeNotes: data.employeeNotes || '',
        status: 'Submitted to HR',
        hrNotes: '',
        visaReference: '',
        validFrom: '',
        validUntil: '',
        collectionInstructions: '',
        processedBy: '',
        processedAt: '',
      };

      const hrChannelId = process.env.HR_CHANNEL_ID;
      if (!hrChannelId) throw new Error('HR_CHANNEL_ID is not configured.');

      await addVisaRequest(request);
      await client.chat.postMessage({
        channel: hrChannelId,
        text: `Exit re-entry visa request — ${employee.name}`,
        blocks: visaQueueBlocks(request),
      });
      await client.chat.postMessage({
        channel: body.user.id,
        text: `✅ *Your exit re-entry visa request has been sent to HR.*\n\n*Purpose:* ${request.purpose}\n*Payment responsibility:* ${request.paymentResponsibility}\n*Visa type:* ${request.visaType}\n*Requested duration:* ${request.requestedDuration}\n\nHR will notify you privately after reviewing and completing the official issuance process.`,
      });
    } catch (err) {
      logger.error('Error submitting exit re-entry visa request:', err);
      await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Something went wrong while submitting your visa request. Please try again or contact HR.',
      });
    }
  });

  // ─── HR action buttons ────────────────────────────────────────────────────
  async function openHrDecisionModal({ ack, body, action, client, logger }, modalBuilder) {
    await ack();
    if (!isVisaHrUser(body.user.id)) {
      await client.chat.postMessage({
        channel: body.user.id,
        text: '⛔ Only authorised HR users can process exit re-entry visa requests.',
      });
      return;
    }
    try {
      // Slack trigger IDs expire quickly. Open the modal immediately and verify
      // the request status safely when HR submits the decision.
      await client.views.open({
        trigger_id: body.trigger_id,
        view: modalBuilder({ requestId: action.value, channel: body.channel?.id || body.container?.channel_id, ts: body.message?.ts || body.container?.message_ts }),
      });
    } catch (err) {
      logger.error('Error opening visa HR decision modal:', err);
    }
  }

  app.action('visa_mark_issued', async (args) => openHrDecisionModal(args, buildVisaIssuedModal));
  app.action('visa_cannot_issue', async (args) => openHrDecisionModal(args, buildVisaCannotIssueModal));

  async function processHrDecision({ ack, view, body, client, logger }, status) {
    const metadata = JSON.parse(view.private_metadata || '{}');
    const requestId = metadata.requestId;
    const decisionFields = collectVisaDecisionFields(view, status);
    const validationErrors = status === 'Issued' ? isValidIssuedVisaFields(decisionFields) : {};
    if (Object.keys(validationErrors).length > 0) {
      await ack({ response_action: 'errors', errors: validationErrors });
      return;
    }

    await ack();
    if (!isVisaHrUser(body.user.id) || processingVisaRequests.has(requestId)) return;
    processingVisaRequests.add(requestId);

    try {
      const request = await getVisaRequestById(requestId);
      if (!request || request.status !== 'Submitted to HR') return;

      const updatedRequest = {
        ...request,
        ...decisionFields,
        processedBy: body.user.id,
        processedAt: new Date().toISOString(),
      };
      await updateVisaRequest(requestId, updatedRequest);
      await replaceVisaQueueMessage(client, { channel: { id: metadata.channel }, message: { ts: metadata.ts } }, updatedRequest);
      await client.chat.postMessage({
        channel: request.employeeSlackId,
        text: visaEmployeeResultText(updatedRequest),
      });
    } catch (err) {
      logger.error('Error processing exit re-entry visa decision:', err);
      await client.chat.postMessage({
        channel: body.user.id,
        text: '❌ Something went wrong while recording the visa decision. Please try again or contact the system administrator.',
      });
    } finally {
      processingVisaRequests.delete(requestId);
    }
  }

  app.view('visa_issued_submit', async (args) => processHrDecision(args, 'Issued'));
  app.view('visa_cannot_issue_submit', async (args) => processHrDecision(args, 'Not Issued'));
}

module.exports = {
  registerVisaRequestHandlers,
  __testables: {
    readVisaRequestForm,
  },
};
