const { formatDate, saudiTodayDateString } = require('./dates');

function calculatePaymentResponsibility(purpose) {
  if (purpose === 'Work') return 'Company paid';
  if (purpose === 'Personal') return 'Employee paid';
  throw new Error(`Unsupported visa purpose: ${purpose}`);
}

function isValidVisaRequestForm(data, todayDateString = saudiTodayDateString()) {
  const errors = {};
  if (!data.purpose) errors.visa_purpose_block = 'Please select the travel purpose.';
  if (!data.visaType) errors.visa_type_block = 'Please select a visa type.';
  if (!data.requestedDuration) errors.visa_duration_block = 'Please select the requested duration.';
  if (!data.departureDate) errors.departure_date_block = 'Please select your planned departure date.';
  if (!data.returnDate) errors.return_date_block = 'Please select your planned return date.';
  if (!data.employeeNotes?.trim()) errors.visa_notes_block = 'Please enter travel details for HR.';
  if (data.departureDate && data.departureDate < todayDateString) {
    errors.departure_date_block = 'The departure date cannot be in the past.';
  }
  if (data.departureDate && data.returnDate && data.returnDate < data.departureDate) {
    errors.return_date_block = 'The return date cannot be before the departure date.';
  }
  return errors;
}

function isValidIssuedVisaFields(fields) {
  const errors = {};
  if (fields.validFrom && fields.validUntil && fields.validUntil < fields.validFrom) {
    errors.valid_until_block = 'The valid-until date cannot be before the valid-from date.';
  }
  return errors;
}

function isVisaHrUser(userId) {
  const configuredApprovers = (process.env.VISA_HR_APPROVER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const hrManager = process.env.HR_MANAGER_ID || '';
  const adminUsers = (process.env.ADMIN_SLACK_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return [...configuredApprovers, hrManager, ...adminUsers].includes(userId);
}

function visaRequestDetails(request) {
  return `*Employee:* <@${request.employeeSlackId}> (${request.employeeName})\n*Purpose:* ${request.purpose}\n*Payment:* ${request.paymentResponsibility}\n*Visa Type:* ${request.visaType}\n*Requested Duration:* ${request.requestedDuration}\n*Travel Dates:* ${formatDate(request.departureDate)} → ${formatDate(request.returnDate)}${request.destination ? `\n*Destination:* ${request.destination}` : ''}${request.employeeNotes ? `\n*Employee notes:*\n> ${request.employeeNotes}` : ''}`;
}

function visaQueueBlocks(request) {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🛂 Exit Re-Entry Visa Request', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: visaRequestDetails(request) },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Payment responsibility is applied automatically from the employee’s selected purpose. HR must complete the visa through the official government process before marking it as issued.',
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'actions',
      block_id: 'visa_request_actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Mark Issued', emoji: true },
          style: 'primary',
          action_id: 'visa_mark_issued',
          value: request.requestId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Cannot Issue', emoji: true },
          style: 'danger',
          action_id: 'visa_cannot_issue',
          value: request.requestId,
        },
      ],
    },
  ];
}

function visaFinalStatusBlocks(request) {
  const statusConfig = {
    Issued: { icon: '✅', title: 'Exit Re-Entry Visa Issued' },
    'Not Issued': { icon: '❌', title: 'Exit Re-Entry Visa — Not Issued' },
  };
  const config = statusConfig[request.status] || { icon: 'ℹ️', title: 'Exit Re-Entry Visa Status Updated' };
  const details = visaRequestDetails(request);
  const issuedDetails = request.status === 'Issued'
    ? `${request.visaReference ? `\n*Visa Number / Reference:* ${request.visaReference}` : ''}${request.validFrom ? `\n*Valid From:* ${formatDate(request.validFrom)}` : ''}${request.validUntil ? `\n*Valid Until:* ${formatDate(request.validUntil)}` : ''}${request.collectionInstructions ? `\n*Document / Collection Instructions:*\n${request.collectionInstructions}` : ''}`
    : '';
  const hrNotes = request.hrNotes ? `\n*HR notes:*\n> ${request.hrNotes}` : '';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${config.icon} *${config.title}*\n\n${details}${issuedDetails}${hrNotes}\n\n*Processed by:* <@${request.processedBy}>`,
      },
    },
  ];
}

function visaEmployeeResultText(request) {
  if (request.status === 'Issued') {
    return `✅ *Your exit re-entry visa has been issued.*\n\n*Visa Type:* ${request.visaType}\n*Requested Duration:* ${request.requestedDuration}${request.visaReference ? `\n*Visa Number / Reference:* ${request.visaReference}` : ''}${request.validFrom ? `\n*Valid From:* ${formatDate(request.validFrom)}` : ''}${request.validUntil ? `\n*Valid Until:* ${formatDate(request.validUntil)}` : ''}${request.collectionInstructions ? `\n\n*Document / Collection Instructions:*\n${request.collectionInstructions}` : ''}${request.hrNotes ? `\n\n*HR notes:*\n> ${request.hrNotes}` : ''}\n\nPlease check the official visa details carefully before travelling.`;
  }

  return `❌ *HR could not issue your exit re-entry visa request.*\n\n${request.hrNotes ? `*Reason / HR notes:*\n> ${request.hrNotes}\n\n` : ''}Please contact HR privately if you need clarification.`;
}

module.exports = {
  calculatePaymentResponsibility,
  isValidVisaRequestForm,
  isValidIssuedVisaFields,
  isVisaHrUser,
  visaRequestDetails,
  visaQueueBlocks,
  visaFinalStatusBlocks,
  visaEmployeeResultText,
};
