const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const {
  maternityLeavePeriod,
  leaveDayUnit,
  leaveDurationLabel,
  validateMaternityDeliveryDate,
  hasMaternityDateConflict,
} = require('../src/utils/maternityLeave');
const {
  LEAVE_TYPE_OPTIONS,
  buildLeaveRequestModal,
  buildMaternityLeaveRequestModal,
  buildConfirmationModal,
} = require('../src/modals/leaveRequestModal');
const { formatDate } = require('../src/utils/dates');

function block(modal, id) {
  return modal.blocks.find((item) => item.block_id === id);
}

function textOf(modal) {
  return modal.blocks.flatMap((item) => [
    item.text?.text || '',
    ...(item.fields || []).map((field) => field.text),
    ...(item.elements || []).map((element) => element.text || ''),
  ]).join('\n');
}

const PERIOD_CASES = [
  { startDate: '2026-11-12', endDate: '2027-02-11', returnDate: '2027-02-12', totalDays: 92 },
  { startDate: '2026-01-31', endDate: '2026-04-29', returnDate: '2026-04-30', totalDays: 89 },
  { startDate: '2023-11-30', endDate: '2024-02-28', returnDate: '2024-02-29', totalDays: 91 },
  { startDate: '2024-11-30', endDate: '2025-02-27', returnDate: '2025-02-28', totalDays: 90 },
  { startDate: '2024-02-29', endDate: '2024-05-28', returnDate: '2024-05-29', totalDays: 90 },
  { startDate: '2026-08-31', endDate: '2026-11-29', returnDate: '2026-11-30', totalDays: 91 },
  { startDate: '2026-03-08', endDate: '2026-06-07', returnDate: '2026-06-08', totalDays: 92 },
];

for (const expected of PERIOD_CASES) {
  test(`three calendar months from ${expected.startDate}, inclusive, with clamped anniversary`, () => {
    assert.deepEqual(maternityLeavePeriod(expected.startDate), expected);
    assert.equal(
      (Date.parse(expected.endDate) - Date.parse(expected.startDate)) / 86400000 + 1,
      expected.totalDays,
    );
    assert.equal(Date.parse(expected.returnDate) - Date.parse(expected.endDate), 86400000);
  });
}

test('uses a direct third-month anniversary rather than accumulating monthly clamping', () => {
  assert.equal(maternityLeavePeriod('2026-01-31').returnDate, '2026-04-30');
  assert.equal(maternityLeavePeriod('2026-05-31').returnDate, '2026-08-31');
  assert.equal(maternityLeavePeriod('2026-12-31').returnDate, '2027-03-31');
});

test('strictly validates Gregorian years, including century leap rules and years below 100', () => {
  assert.equal(maternityLeavePeriod('0001-01-31').returnDate, '0001-04-30');
  assert.equal(maternityLeavePeriod('0099-11-30').returnDate, '0100-02-28');
  assert.equal(maternityLeavePeriod('2000-02-29').returnDate, '2000-05-29');
  assert.equal(maternityLeavePeriod('2400-02-29').returnDate, '2400-05-29');
  for (const invalid of ['1900-02-29', '2100-02-29', '2023-02-29', '0000-01-01']) {
    assert.throws(() => maternityLeavePeriod(invalid), RangeError);
  }
});

test('rejects malformed or rolled-over dates rather than letting JavaScript normalize them', () => {
  const invalidDates = [
    undefined, null, '', 20261112, new Date(),
    '2026-2-01', '26-02-01', '2026-02-1', '2026/02/01',
    '2026-04-31', '2026-02-30', '2026-13-01', '2026-00-01', '2026-01-00',
    ' 2026-11-12', '2026-11-12 ', '2026-11-12\n',
    '2026-11-12T00:00:00Z', '2026-11-12T03:00:00+03:00',
  ];
  for (const invalid of invalidDates) {
    assert.throws(() => maternityLeavePeriod(invalid), RangeError);
    assert.notEqual(validateMaternityDeliveryDate(invalid, '2026-11-12'), '');
  }
});

test('requires an actual delivery date on or before today without arbitrary past-date eligibility rules', () => {
  assert.equal(validateMaternityDeliveryDate('2026-11-12', '2026-11-12'), '');
  assert.equal(validateMaternityDeliveryDate('2026-11-11', '2026-11-12'), '');
  assert.equal(validateMaternityDeliveryDate('1950-01-01', '2026-11-12'), '');
  assert.match(validateMaternityDeliveryDate('2026-11-13', '2026-11-12'), /future/);
  assert.match(validateMaternityDeliveryDate('2026-11-13', '2026-11-12'), /actual.*estimated/);
  assert.match(validateMaternityDeliveryDate('2026-11-12', '2026-02-30'), /today/);
  assert.equal(validateMaternityDeliveryDate('2000-01-01'), '');
});

test('UTC date arithmetic and maternity confirmation formatting are timezone and DST independent', () => {
  const utilityPath = path.resolve(__dirname, '../src/utils/maternityLeave.js');
  const modalPath = path.resolve(__dirname, '../src/modals/leaveRequestModal.js');
  const script = `
    const { maternityLeavePeriod } = require(${JSON.stringify(utilityPath)});
    const { buildConfirmationModal } = require(${JSON.stringify(modalPath)});
    console.log(JSON.stringify({
      periods: ${JSON.stringify(PERIOD_CASES.map((item) => item.startDate))}.map(maternityLeavePeriod),
      fields: buildConfirmationModal({leaveType: 'Maternity', deliveryDate: '2026-11-12'}).blocks[2].fields,
    }));
  `;
  const results = ['UTC', 'Asia/Riyadh', 'America/Los_Angeles', 'America/New_York', 'Pacific/Kiritimati']
    .map((timeZone) => JSON.parse(execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: timeZone }, encoding: 'utf8',
    })));
  for (const result of results) {
    assert.deepEqual(result.periods, PERIOD_CASES);
    assert.deepEqual(result.fields, results[0].fields);
    assert.match(result.fields[2].text, /12 Nov 2026/);
    assert.match(result.fields[3].text, /11 Feb 2027/);
    assert.match(result.fields[4].text, /12 Feb 2027/);
  }
});

test('labels maternity in calendar days and preserves working-day units for existing types', () => {
  assert.equal(leaveDayUnit('Maternity'), 'calendar day(s)');
  assert.equal(leaveDurationLabel('Maternity', 92), '92 calendar day(s)');
  for (const leaveType of ['Annual', 'Sick', 'Hajj', undefined]) {
    assert.equal(leaveDayUnit(leaveType), 'working day(s)');
    assert.equal(leaveDurationLabel(leaveType, 3), '3 working day(s)');
  }
});

test('detects the same maternity delivery/start date except for rejected or cancelled records', () => {
  for (const status of ['Pending Documents', 'Pending', 'Approved', 'Approval Processing', undefined]) {
    assert.equal(hasMaternityDateConflict([
      { leaveType: 'Maternity', deliveryDate: '2026-11-12', status },
    ], '2026-11-12'), true);
    assert.equal(hasMaternityDateConflict([
      { leaveType: 'Maternity', startDate: '2026-11-12', status },
    ], '2026-11-12'), true);
  }
  assert.equal(hasMaternityDateConflict([
    { leaveType: 'Maternity', startDate: '2026-11-12', status: 'Rejected' },
    { leaveType: 'Maternity', deliveryDate: '2026-11-12', status: 'Cancelled' },
    { leaveType: 'Annual', startDate: '2026-11-12', status: 'Approved' },
    { leaveType: 'Maternity', startDate: '2026-11-11', status: 'Approved' },
    null,
  ], '2026-11-12'), false);
  assert.equal(hasMaternityDateConflict([], '2026-11-12'), false);
  assert.equal(hasMaternityDateConflict(null, '2026-11-12'), false);
  assert.equal(hasMaternityDateConflict([{ leaveType: 'Maternity', startDate: 'invalid' }], 'invalid'), false);
});

test('initial leave form has all four choices and dispatches its leave-type selection', () => {
  const modal = buildLeaveRequestModal({}, { maternityEligible: true });
  assert.equal(modal.callback_id, 'leave_request_review');
  const input = block(modal, 'leave_type_block');
  assert.equal(input.dispatch_action, true);
  assert.equal(input.element.type, 'static_select');
  assert.equal(input.element.action_id, 'leave_type_select');
  assert.deepEqual(input.element.options.map((option) => option.value), ['Annual', 'Sick', 'Hajj', 'Maternity']);
  assert.equal(input.element.initial_option, undefined);
  assert.equal(block(modal, 'start_date_block').element.action_id, 'start_date_pick');
  assert.equal(block(modal, 'end_date_block').element.action_id, 'end_date_pick');
  assert.equal(block(modal, 'notes_block').element.action_id, 'notes_input');
});

test('prefilled options use the exact option record while existing fields and callbacks remain intact', () => {
  for (const leaveType of ['Annual', 'Sick', 'Hajj']) {
    const modal = buildLeaveRequestModal({
      leaveType, startDate: '2026-11-12', endDate: '2026-11-16', notes: 'Existing notes',
    });
    const input = block(modal, 'leave_type_block');
    assert.equal(input.element.initial_option, LEAVE_TYPE_OPTIONS.find((option) => option.value === leaveType));
    assert.equal(modal.callback_id, 'leave_request_review');
    assert.equal(block(modal, 'start_date_block').element.initial_date, '2026-11-12');
    assert.equal(block(modal, 'end_date_block').element.initial_date, '2026-11-16');
    assert.equal(block(modal, 'notes_block').element.initial_value, 'Existing notes');
  }
  assert.equal(block(buildLeaveRequestModal({ leaveType: 'Unknown' }), 'leave_type_block').element.initial_option, undefined);
});

test('maternity form requires actual delivery date only, allows switching types, and requests private DM proof', () => {
  const modal = buildMaternityLeaveRequestModal(
    { deliveryDate: '2026-11-12', notes: 'Maternity notes' },
    { maternityEligible: true },
  );
  assert.equal(modal.callback_id, 'maternity_leave_review');
  const input = block(modal, 'leave_type_block');
  assert.equal(input.dispatch_action, true);
  assert.equal(input.element.action_id, 'leave_type_select');
  assert.equal(input.element.options, LEAVE_TYPE_OPTIONS);
  assert.equal(input.element.initial_option, LEAVE_TYPE_OPTIONS.find((option) => option.value === 'Maternity'));
  const delivery = block(modal, 'delivery_date_block');
  assert.equal(delivery.element.type, 'datepicker');
  assert.equal(delivery.element.action_id, 'delivery_date_pick');
  assert.equal(delivery.optional, undefined);
  assert.equal(delivery.element.initial_date, '2026-11-12');
  assert.equal(block(modal, 'start_date_block'), undefined);
  assert.equal(block(modal, 'end_date_block'), undefined);
  assert.equal(block(modal, 'notes_block').element.action_id, 'notes_input');
  assert.equal(block(modal, 'notes_block').element.initial_value, 'Maternity notes');
  assert.equal(block(modal, 'notes_block').optional, true);
  assert.doesNotMatch(JSON.stringify(modal), /file_input|file_upload/);
  assert.match(textOf(modal), /three calendar months/);
  assert.match(textOf(modal), /inclusive/);
  assert.match(textOf(modal), /No annual leave is deducted/);
  assert.match(textOf(modal), /After confirming.*document proving the actual delivery date.*private DM with the bot.*before/);
  assert.equal(block(buildMaternityLeaveRequestModal(
    { startDate: '2026-11-12' }, { maternityEligible: true },
  ), 'delivery_date_block').element.initial_date, '2026-11-12');
  assert.equal(buildLeaveRequestModal(
    { leaveType: 'Maternity' }, { maternityEligible: true },
  ).callback_id, 'maternity_leave_review');
});

test('maternity confirmation carries derived dates and calendar basis without annual deduction or Hajj instructions', () => {
  const modal = buildConfirmationModal({
    leaveType: 'Maternity', deliveryDate: '2026-11-12',
    startDate: '2026-11-01', endDate: '2026-11-02', returnDate: '2026-11-03',
    totalDays: 2, dayBasis: 'working', annualRemaining: 20, notes: 'Maternity notes',
  });
  assert.equal(modal.callback_id, 'leave_request_submit');
  assert.deepEqual(JSON.parse(modal.private_metadata), {
    leaveType: 'Maternity', startDate: '2026-11-12', endDate: '2027-02-11',
    notes: 'Maternity notes', deliveryDate: '2026-11-12', returnDate: '2027-02-12', dayBasis: 'calendar',
  });
  assert.match(textOf(modal), /Total Calendar Days/);
  assert.match(textOf(modal), /92 calendar day\(s\)/);
  assert.match(textOf(modal), /Actual Delivery Date \/ Start Date \(inclusive\)/);
  assert.match(textOf(modal), /Last Leave Day \(inclusive\)/);
  assert.match(textOf(modal), /Return Date \(three-month anniversary\)/);
  assert.match(textOf(modal), /No annual leave is deducted/);
  assert.match(textOf(modal), /After confirming.*document proving the actual delivery date.*private DM with the bot.*before approval/);
  assert.doesNotMatch(textOf(modal), /working|Hajj|annual leave remaining/);
});

test('maternity confirmation accepts the existing startDate call shape as deliveryDate', () => {
  const modal = buildConfirmationModal({ leaveType: 'Maternity', startDate: '2026-01-31' });
  const metadata = JSON.parse(modal.private_metadata);
  assert.equal(metadata.deliveryDate, '2026-01-31');
  assert.equal(metadata.endDate, '2026-04-29');
  assert.equal(metadata.returnDate, '2026-04-30');
  assert.match(textOf(modal), /89 calendar day\(s\)/);
  assert.throws(() => buildConfirmationModal({ leaveType: 'Maternity', deliveryDate: '2026-02-30' }), RangeError);
});

test('existing Annual, Sick, and Hajj confirmation content and metadata remain unchanged', () => {
  const context = {
    Annual: 'After this request, you will have *17 day(s)* of annual leave remaining.',
    Sick: '📎 After confirming, the bot will send you a private DM asking you to upload your *Sehhaty (صحتي) screenshot* and *hospital report*.',
    Hajj: '📎 After confirming, the bot will send you a private DM asking you to upload your *official Hajj permission document*.',
  };
  const icons = { Annual: '🏖️', Sick: '🤒', Hajj: '🕌' };
  for (const leaveType of ['Annual', 'Sick', 'Hajj']) {
    const modal = buildConfirmationModal({
      leaveType, startDate: '2026-11-12', endDate: '2026-11-16', notes: 'Original notes',
      totalDays: 3, annualRemaining: 20, deliveryDate: '2026-11-12', returnDate: '2027-02-12', dayBasis: 'calendar',
    });
    assert.equal(modal.callback_id, 'leave_request_submit');
    assert.deepEqual(JSON.parse(modal.private_metadata), {
      leaveType, startDate: '2026-11-12', endDate: '2026-11-16', notes: 'Original notes',
    });
    assert.deepEqual(modal.blocks[2].fields, [
      { type: 'mrkdwn', text: `*Leave Type:*\n${icons[leaveType]} ${leaveType} Leave` },
      { type: 'mrkdwn', text: '*Total Working Days:*\n📅 *3 day(s)*' },
      { type: 'mrkdwn', text: `*Start Date:*\n${formatDate('2026-11-12')}` },
      { type: 'mrkdwn', text: `*End Date:*\n${formatDate('2026-11-16')}` },
    ]);
    assert.equal(modal.blocks.at(-1).elements[0].text, context[leaveType]);
    assert.doesNotMatch(textOf(modal), /Calendar Days|delivery date|Return Date/);
  }
});

test('maternity forms and confirmations honor Slack text, option, and metadata limits', () => {
  const modals = [
    buildLeaveRequestModal({}, { maternityEligible: true }),
    buildMaternityLeaveRequestModal({ notes: 'x'.repeat(1000) }, { maternityEligible: true }),
    buildConfirmationModal({ leaveType: 'Maternity', deliveryDate: '2026-11-12', notes: 'x'.repeat(1000) }),
  ];
  for (const modal of modals) {
    assert.ok(Array.from(modal.title.text).length <= 24);
    assert.ok(Array.from(modal.submit.text).length <= 24);
    assert.ok(Array.from(modal.close.text).length <= 24);
    if (modal.private_metadata) assert.ok(modal.private_metadata.length <= 3000);
    for (const item of modal.blocks) {
      if (item.label) assert.ok(item.label.text.length <= 2000);
      if (item.text) assert.ok(item.text.text.length <= 3000);
      for (const field of item.fields || []) assert.ok(field.text.length <= 2000);
      for (const element of item.elements || []) assert.ok((element.text || '').length <= 3000);
      for (const option of item.element?.options || []) assert.ok(Array.from(option.text.text).length <= 75);
    }
  }
  // JSON escaping can enlarge otherwise short notes; never send oversized metadata.
  assert.throws(() => buildConfirmationModal({
    leaveType: 'Maternity', deliveryDate: '2026-11-12', notes: '\u0001'.repeat(1000),
  }), /too long/);
});
