const test = require('node:test');
const assert = require('node:assert/strict');
const { isMaternityEligible } = require('../src/utils/maternityLeave');
const {
  LEAVE_TYPE_OPTIONS,
  buildLeaveLoadingModal,
  buildLeaveRequestModal,
  buildMaternityLeaveRequestModal,
} = require('../src/modals/leaveRequestModal');

const NORMAL_TYPES = ['Annual', 'Sick', 'Hajj'];
const ALL_TYPES = [...NORMAL_TYPES, 'Maternity'];

function block(modal, id) {
  return modal.blocks.find((item) => item.block_id === id);
}

function select(modal) {
  return block(modal, 'leave_type_block').element;
}

function assertNormalForm(modal) {
  assert.equal(modal.callback_id, 'leave_request_review');
  assert.deepEqual(select(modal).options.map((option) => option.value), NORMAL_TYPES);
  assert.ok(block(modal, 'start_date_block'));
  assert.ok(block(modal, 'end_date_block'));
  assert.equal(block(modal, 'delivery_date_block'), undefined);
  assert.doesNotMatch(JSON.stringify(modal), /maternity|delivery date|three calendar months/i);
}

test('eligibility accepts only employee.maternityEligible boolean true', () => {
  assert.equal(isMaternityEligible({ maternityEligible: true }), true);
  for (const value of [undefined, null, false, '', 'NO', 'YES', 'true', 'false', 0, 1, [], {}, new Boolean(true)]) {
    assert.equal(isMaternityEligible({ maternityEligible: value }), false);
  }
  for (const employee of [undefined, null, {}, true, false, 'YES']) {
    assert.equal(isMaternityEligible(employee), false);
  }
});

test('eligibility never infers permission from names, gender, roles, or other fields', () => {
  for (const profile of [
    { name: 'Fatima', gender: 'Female', role: 'Employee' },
    { name: 'Ahmed', gender: 'Male', role: 'Manager' },
    { name: 'Unknown', sex: 'F', jobTitle: 'HR', maternity_eligible: true },
  ]) {
    assert.equal(isMaternityEligible(profile), false);
    assert.equal(isMaternityEligible({ ...profile, maternityEligible: false }), false);
    assert.equal(isMaternityEligible({ ...profile, maternityEligible: true }), true);
  }
});

test('default and explicitly ineligible leave forms offer exactly Annual, Sick, and Hajj', () => {
  assertNormalForm(buildLeaveRequestModal());
  assertNormalForm(buildLeaveRequestModal({}));
  for (const maternityEligible of [undefined, false, null, '', 'NO', 'YES', 'true', 1]) {
    assertNormalForm(buildLeaveRequestModal({}, { maternityEligible }));
  }
});

test('NO and blank employee eligibility yield the same filtered leave form', () => {
  const noEmployee = { maternityEligible: false };
  const blankEmployee = { maternityEligible: undefined };
  const noModal = buildLeaveRequestModal({}, { maternityEligible: isMaternityEligible(noEmployee) });
  const blankModal = buildLeaveRequestModal({}, { maternityEligible: isMaternityEligible(blankEmployee) });
  assertNormalForm(noModal);
  assertNormalForm(blankModal);
  assert.deepEqual(noModal, blankModal);
});

test('explicitly eligible leave form offers the full exported four-option catalog', () => {
  const modal = buildLeaveRequestModal({}, { maternityEligible: true });
  assert.deepEqual(select(modal).options.map((option) => option.value), ALL_TYPES);
  assert.equal(select(modal).options, LEAVE_TYPE_OPTIONS);
  assert.equal(select(modal).initial_option, undefined);
  assert.match(JSON.stringify(modal), /Sick, Hajj or Maternity Leave/);
  assert.deepEqual(LEAVE_TYPE_OPTIONS.map((option) => option.value), ALL_TYPES);
});

test('initial options are the exact permitted label/value records in both eligibility contexts', () => {
  for (const maternityEligible of [false, true]) {
    for (const leaveType of NORMAL_TYPES) {
      const modal = buildLeaveRequestModal({
        leaveType, startDate: '2026-11-12', endDate: '2026-11-16', notes: 'Existing notes',
      }, { maternityEligible });
      const element = select(modal);
      const permittedOption = element.options.find((option) => option.value === leaveType);
      assert.equal(element.initial_option, permittedOption);
      assert.equal(element.initial_option, LEAVE_TYPE_OPTIONS.find((option) => option.value === leaveType));
      assert.deepEqual(element.initial_option.text, permittedOption.text);
      assert.equal(block(modal, 'start_date_block').element.initial_date, '2026-11-12');
      assert.equal(block(modal, 'end_date_block').element.initial_date, '2026-11-16');
      assert.equal(block(modal, 'notes_block').element.initial_value, 'Existing notes');
    }
    assert.equal(select(buildLeaveRequestModal({ leaveType: 'Unknown' }, { maternityEligible })).initial_option, undefined);
  }
});

test('maternity prefill cannot bypass ineligible or default request builder options', () => {
  const prefill = {
    leaveType: 'Maternity', deliveryDate: '2026-11-12', startDate: '2026-11-12',
    endDate: '2027-02-11', maternityEligible: true,
  };
  for (const options of [undefined, {}, { maternityEligible: false }, { maternityEligible: 'YES' }]) {
    const modal = buildLeaveRequestModal(prefill, options);
    assertNormalForm(modal);
    assert.equal(select(modal).initial_option, undefined);
    assert.equal(block(modal, 'start_date_block').element.initial_date, prefill.startDate);
    assert.equal(block(modal, 'end_date_block').element.initial_date, prefill.endDate);
  }
});

test('direct maternity builder defaults to the normal form without recursion or bypass', () => {
  assertNormalForm(buildMaternityLeaveRequestModal());
  for (const options of [undefined, {}, { maternityEligible: false }, { maternityEligible: 'YES' }, { maternityEligible: 1 }]) {
    const modal = buildMaternityLeaveRequestModal({ leaveType: 'Maternity', deliveryDate: '2026-11-12' }, options);
    assertNormalForm(modal);
    assert.equal(select(modal).initial_option, undefined);
  }
  const annual = buildMaternityLeaveRequestModal({ leaveType: 'Annual' });
  assertNormalForm(annual);
  assert.equal(select(annual).initial_option, select(annual).options[0]);
});

test('both request builders render maternity only with explicitly true options', () => {
  for (const build of [buildLeaveRequestModal, buildMaternityLeaveRequestModal]) {
    const modal = build({ leaveType: 'Maternity', deliveryDate: '2026-11-12' }, { maternityEligible: true });
    assert.equal(modal.callback_id, 'maternity_leave_review');
    assert.deepEqual(select(modal).options.map((option) => option.value), ALL_TYPES);
    assert.equal(select(modal).initial_option, select(modal).options.find((option) => option.value === 'Maternity'));
    assert.equal(select(modal).initial_option, LEAVE_TYPE_OPTIONS[3]);
    assert.equal(block(modal, 'delivery_date_block').element.initial_date, '2026-11-12');
    assert.equal(block(modal, 'start_date_block'), undefined);
    assert.equal(block(modal, 'end_date_block'), undefined);
  }
});

test('loading modal contains only a loading section and close control without a form or metadata', () => {
  const modal = buildLeaveLoadingModal();
  assert.equal(modal.type, 'modal');
  assert.equal(modal.callback_id, 'leave_request_loading');
  assert.equal(modal.title.text, 'Loading Leave');
  assert.equal(modal.close.text, 'Close');
  assert.ok(Array.from(modal.title.text).length <= 24);
  assert.equal(Object.hasOwn(modal, 'submit'), false);
  assert.equal(Object.hasOwn(modal, 'private_metadata'), false);
  assert.equal(modal.blocks.length, 1);
  assert.equal(modal.blocks[0].type, 'section');
  assert.match(modal.blocks[0].text.text, /loading/i);
  assert.doesNotMatch(JSON.stringify(modal), /static_select|datepicker|plain_text_input|maternity/i);
  assert.deepEqual(buildLeaveLoadingModal({}), modal);
});

test('unavailable modal shows the supplied message without exposing a leave form', () => {
  const message = 'Unable to load employee details. Please try again later.';
  const modal = buildLeaveLoadingModal({ unavailableMessage: message });
  assert.equal(modal.title.text, 'Leave Unavailable');
  assert.ok(Array.from(modal.title.text).length <= 24);
  assert.equal(modal.close.text, 'Close');
  assert.equal(Object.hasOwn(modal, 'submit'), false);
  assert.equal(Object.hasOwn(modal, 'private_metadata'), false);
  assert.equal(modal.blocks.length, 1);
  assert.equal(modal.blocks[0].type, 'section');
  assert.equal(modal.blocks[0].text.text, message);
});
