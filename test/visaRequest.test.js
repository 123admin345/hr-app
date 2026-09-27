const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePaymentResponsibility,
  isValidVisaRequestForm,
  isValidIssuedVisaFields,
  visaQueueBlocks,
  visaFinalStatusBlocks,
  visaEmployeeResultText,
} = require('../src/utils/visaRequest');

test('assigns exit re-entry visa payment responsibility from request purpose', () => {
  assert.equal(calculatePaymentResponsibility('Work'), 'Company paid');
  assert.equal(calculatePaymentResponsibility('Personal'), 'Employee paid');
  assert.throws(() => calculatePaymentResponsibility('Other'), /Unsupported visa purpose/);
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
