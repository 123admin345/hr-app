const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  calculatePaymentResponsibility,
  isValidVisaRequestForm,
  isValidIssuedVisaFields,
  isVisaHrUser,
  visaQueueBlocks,
  visaFinalStatusBlocks,
  visaEmployeeResultText,
} = require('../src/utils/visaRequest');

test('assigns exit re-entry visa payment responsibility from request purpose', () => {
  assert.equal(calculatePaymentResponsibility('Work'), 'Company paid');
  assert.equal(calculatePaymentResponsibility('Personal'), 'Employee paid');
  assert.throws(() => calculatePaymentResponsibility('Other'), /Unsupported visa purpose/);
});

test('keeps the HR manager, admins, and comma-separated additional HR users authorised', () => {
  const original = {
    VISA_HR_APPROVER_IDS: process.env.VISA_HR_APPROVER_IDS,
    HR_MANAGER_ID: process.env.HR_MANAGER_ID,
    ADMIN_SLACK_IDS: process.env.ADMIN_SLACK_IDS,
  };
  process.env.VISA_HR_APPROVER_IDS = 'U-VISA-ONE,U-VISA-TWO';
  process.env.HR_MANAGER_ID = 'U-HR-MANAGER';
  process.env.ADMIN_SLACK_IDS = 'U-ADMIN';

  assert.equal(isVisaHrUser('U-VISA-ONE'), true);
  assert.equal(isVisaHrUser('U-VISA-TWO'), true);
  assert.equal(isVisaHrUser('U-HR-MANAGER'), true);
  assert.equal(isVisaHrUser('U-ADMIN'), true);
  assert.equal(isVisaHrUser('U-UNAUTHORISED'), false);

  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('rejects invalid exit re-entry travel dates before HR receives the request', () => {
  const errors = isValidVisaRequestForm({
    purpose: 'Personal',
    visaType: 'Single',
    requestedDuration: '1 month',
    departureDate: '2026-11-20',
    returnDate: '2026-11-18',
    employeeNotes: 'Family visit',
  }, '2026-01-01');

  assert.match(errors.return_date_block, /cannot be before/);
});

test('rejects issued visa validity dates that are in the wrong order', () => {
  const errors = isValidIssuedVisaFields({
    validFrom: '2026-11-20',
    validUntil: '2026-11-19',
  });

  assert.match(errors.valid_until_block, /cannot be before/);
});

test('builds an HR-only visa queue message with actions', () => {
  const blocks = visaQueueBlocks({
    employeeName: 'Sample Employee',
    employeeSlackId: 'U-EMPLOYEE',
    purpose: 'Work',
    paymentResponsibility: 'Company paid',
    visaType: 'Multiple',
    requestedDuration: '6 months',
    departureDate: '2026-11-20',
    returnDate: '2026-12-02',
    destination: 'Dubai',
    employeeNotes: 'Client meetings',
    requestId: 'VISA-TEST',
  });

  assert.equal(blocks.some((block) => block.type === 'actions'), true);
  assert.match(blocks[1].text.text, /Company paid/);
  assert.match(blocks[1].text.text, /Multiple/);
  assert.doesNotMatch(JSON.stringify(blocks), /Need Information|visa_need_information/);
  const actionBlock = blocks.find((block) => block.type === 'actions');
  assert.equal(actionBlock.elements.length, 2);
});

test('formats issued visa details for the employee and removes HR actions', () => {
  const request = {
    employeeName: 'Sample Employee',
    employeeSlackId: 'U-EMPLOYEE',
    purpose: 'Personal',
    paymentResponsibility: 'Employee paid',
    visaType: 'Single',
    requestedDuration: '1 month',
    departureDate: '2026-11-20',
    returnDate: '2026-12-02',
    status: 'Issued',
    visaReference: 'ER-12345',
    validFrom: '2026-11-20',
    validUntil: '2026-12-20',
    collectionInstructions: 'Visa is available in the government portal.',
    hrNotes: 'Please travel before expiry.',
    processedBy: 'U-HR',
  };

  const finalBlocks = visaFinalStatusBlocks(request);
  const employeeText = visaEmployeeResultText(request);

  assert.equal(finalBlocks.some((block) => block.type === 'actions'), false);
  assert.match(employeeText, /ER-12345/);
  assert.match(employeeText, /Please travel before expiry/);
});

test('opens the HR visa decision modal without waiting for Google Sheets', () => {
  const handlerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'handlers', 'visaRequestHandler.js'),
    'utf8',
  );
  const start = handlerSource.indexOf('async function openHrDecisionModal');
  const end = handlerSource.indexOf("app.action('visa_mark_issued'");
  const actionHandlerSource = handlerSource.slice(start, end);

  assert.match(actionHandlerSource, /client\.views\.open/);
  assert.doesNotMatch(actionHandlerSource, /getVisaRequestById/);
});
