const { formatDate } = require('../utils/dates');
const { calculatePaymentResponsibility } = require('../utils/visaRequest');

function buildVisaRequestModal() {
  return {
    type: 'modal',
    callback_id: 'visa_request_review',
    title: { type: 'plain_text', text: 'Exit Re-Entry Visa', emoji: true },
    submit: { type: 'plain_text', text: 'Review Request', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Use this form to request an exit re-entry visa from HR. The request is confidential and goes directly to the HR queue. HR will issue the visa through the official government process, then notify you here.',
        },
      },
      { type: 'divider' },
      {
        type: 'input',
        block_id: 'visa_purpose_block',
        element: {
          type: 'static_select',
          action_id: 'visa_purpose_select',
          placeholder: { type: 'plain_text', text: 'Select travel purpose' },
          options: [
            { text: { type: 'plain_text', text: 'Work related — company pays' }, value: 'Work' },
            { text: { type: 'plain_text', text: 'Personal travel — employee pays' }, value: 'Personal' },
          ],
        },
        label: { type: 'plain_text', text: 'Travel purpose', emoji: true },
      },
      {
        type: 'input',
        block_id: 'visa_type_block',
        element: {
          type: 'static_select',
          action_id: 'visa_type_select',
          placeholder: { type: 'plain_text', text: 'Select visa type' },
          options: [
            { text: { type: 'plain_text', text: 'Single exit re-entry' }, value: 'Single' },
            { text: { type: 'plain_text', text: 'Multiple exit re-entry' }, value: 'Multiple' },
          ],
        },
        label: { type: 'plain_text', text: 'Visa type requested', emoji: true },
      },
      {
        type: 'input',
        block_id: 'visa_duration_block',
        element: {
          type: 'static_select',
          action_id: 'visa_duration_select',
          placeholder: { type: 'plain_text', text: 'Select requested duration' },
          options: [
            { text: { type: 'plain_text', text: '1 month' }, value: '1 month' },
            { text: { type: 'plain_text', text: '2 months' }, value: '2 months' },
            { text: { type: 'plain_text', text: '3 months' }, value: '3 months' },
            { text: { type: 'plain_text', text: '6 months' }, value: '6 months' },
            { text: { type: 'plain_text', text: '12 months' }, value: '12 months' },
          ],
        },
        label: { type: 'plain_text', text: 'Requested duration', emoji: true },
      },
      {
        type: 'input',
        block_id: 'departure_date_block',
        element: {
          type: 'datepicker',
          action_id: 'departure_date_pick',
          placeholder: { type: 'plain_text', text: 'Select planned departure date' },
        },
        label: { type: 'plain_text', text: 'Planned departure date', emoji: true },
      },
      {
        type: 'input',
        block_id: 'return_date_block',
        element: {
          type: 'datepicker',
          action_id: 'return_date_pick',
          placeholder: { type: 'plain_text', text: 'Select planned return date' },
        },
        label: { type: 'plain_text', text: 'Planned return date', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'destination_block',
        element: {
          type: 'plain_text_input',
          action_id: 'destination_input',
          placeholder: { type: 'plain_text', text: 'Country / city (optional)' },
        },
        label: { type: 'plain_text', text: 'Destination', emoji: true },
      },
      {
        type: 'input',
        block_id: 'visa_notes_block',
        element: {
          type: 'plain_text_input',
          action_id: 'visa_notes_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Brief reason or travel details for HR' },
        },
        label: { type: 'plain_text', text: 'Travel details for HR', emoji: true },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'The duration is your request only. HR will confirm the final visa validity based on the official issuance process and applicable requirements.',
          },
        ],
      },
    ],
  };
}

function buildVisaRequestConfirmationModal(data) {
  const paymentResponsibility = calculatePaymentResponsibility(data.purpose);
  return {
    type: 'modal',
    callback_id: 'visa_request_submit',
    title: { type: 'plain_text', text: 'Confirm Visa Request', emoji: true },
    submit: { type: 'plain_text', text: 'Submit to HR', emoji: true },
    close: { type: 'plain_text', text: 'Go Back', emoji: true },
    private_metadata: JSON.stringify(data),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*Please review your exit re-entry visa request before sending it to HR.*' },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Purpose:*\n${data.purpose}` },
          { type: 'mrkdwn', text: `*Payment responsibility:*\n${paymentResponsibility}` },
          { type: 'mrkdwn', text: `*Visa type:*\n${data.visaType}` },
          { type: 'mrkdwn', text: `*Requested duration:*\n${data.requestedDuration}` },
          { type: 'mrkdwn', text: `*Departure:*\n${formatDate(data.departureDate)}` },
          { type: 'mrkdwn', text: `*Return:*\n${formatDate(data.returnDate)}` },
        ],
      },
      ...(data.destination ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*Destination:* ${data.destination}` },
      }] : []),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Travel details:*\n${data.employeeNotes}` },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'After submission, the request goes directly to HR. HR will update you privately after the official issuance process is complete.',
          },
        ],
      },
    ],
  };
}

function buildVisaHrActionModal({ callbackId, title, submitLabel, privateMetadata, instruction, fields }) {
  return {
    type: 'modal',
    callback_id: callbackId,
    title: { type: 'plain_text', text: title, emoji: true },
    submit: { type: 'plain_text', text: submitLabel, emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    private_metadata: JSON.stringify(privateMetadata),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: instruction },
      },
      { type: 'divider' },
      ...fields,
    ],
  };
}

function buildVisaIssuedModal(privateMetadata) {
  return buildVisaHrActionModal({
    callbackId: 'visa_issued_submit',
    title: 'Record Issued Visa',
    submitLabel: 'Notify Employee',
    privateMetadata,
    instruction: 'Record the issued visa details below. The employee will receive these details privately in Slack.',
    fields: [
      {
        type: 'input',
        optional: true,
        block_id: 'visa_reference_block',
        element: { type: 'plain_text_input', action_id: 'visa_reference_input', placeholder: { type: 'plain_text', text: 'Visa number or official reference' } },
        label: { type: 'plain_text', text: 'Visa number / reference', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'valid_from_block',
        element: { type: 'datepicker', action_id: 'valid_from_pick', placeholder: { type: 'plain_text', text: 'Select valid-from date' } },
        label: { type: 'plain_text', text: 'Valid from', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'valid_until_block',
        element: { type: 'datepicker', action_id: 'valid_until_pick', placeholder: { type: 'plain_text', text: 'Select expiry / valid-until date' } },
        label: { type: 'plain_text', text: 'Valid until', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'collection_instructions_block',
        element: { type: 'plain_text_input', action_id: 'collection_instructions_input', multiline: true, placeholder: { type: 'plain_text', text: 'Document link, collection method, or employee instructions' } },
        label: { type: 'plain_text', text: 'Document / collection instructions', emoji: true },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'hr_notes_block',
        element: { type: 'plain_text_input', action_id: 'hr_notes_input', multiline: true, placeholder: { type: 'plain_text', text: 'Optional HR note for the employee' } },
        label: { type: 'plain_text', text: 'HR notes', emoji: true },
      },
    ],
  });
}

function buildVisaCannotIssueModal(privateMetadata) {
  return buildVisaHrActionModal({
    callbackId: 'visa_cannot_issue_submit',
    title: 'Cannot Issue Visa',
    submitLabel: 'Notify Employee',
    privateMetadata,
    instruction: 'Record the reason or next step. The employee will receive this privately in Slack.',
    fields: [
      {
        type: 'input',
        block_id: 'hr_notes_block',
        element: { type: 'plain_text_input', action_id: 'hr_notes_input', multiline: true, placeholder: { type: 'plain_text', text: 'Explain the reason or the next HR step' } },
        label: { type: 'plain_text', text: 'Reason / HR notes', emoji: true },
      },
    ],
  });
}

module.exports = {
  buildVisaRequestModal,
  buildVisaRequestConfirmationModal,
  buildVisaIssuedModal,
  buildVisaCannotIssueModal,
};
