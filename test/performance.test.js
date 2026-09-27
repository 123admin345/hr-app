const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOverallRating, scoreLabel } = require('../src/utils/performance');
const { addBusinessDays } = require('../src/utils/dates');
const {
  buildStartReviewModal,
  buildAssessmentModal,
  buildMeetingSlotsModal,
} = require('../src/modals/performanceReviewModal');

test('calculates the official performance rating from six category scores', () => {
  const result = calculateOverallRating({
    quality: 4,
    results: 4,
    accountability: 3,
    collaboration: 4,
    communication: 4,
    conduct: 3,
  });

  assert.deepEqual(result, { average: 3.67, overall: 4, label: 'Exceeds Expectations' });
  assert.equal(scoreLabel(1), 'Below Expectations');
});

test('adds business days while excluding Friday and Saturday', () => {
  assert.equal(addBusinessDays('2026-09-10', 2), '2026-09-14');
});

test('builds a restricted start-review form and six-category assessment form', () => {
  const startModal = buildStartReviewModal();
  const assessmentModal = buildAssessmentModal({
    caseId: 'PERF-TEST',
    role: 'employee',
    employeeName: 'Sample Employee',
    contractEndDate: '2026-12-31',
    initialDueDate: '2026-10-01',
  });

  assert.equal(startModal.callback_id, 'performance_start_review_submit');
  assert.equal(startModal.blocks.filter((block) => block.type === 'input').length, 2);
  assert.equal(assessmentModal.callback_id, 'performance_assessment_submit');
  assert.equal(assessmentModal.blocks.filter((block) => block.block_id?.startsWith('score_')).length, 6);
});

test('keeps proposed employee meeting options within Slack action limits', () => {
  const modal = buildMeetingSlotsModal({
    caseId: 'PERF-TEST',
    employeeName: 'Sample Employee',
    availabilityByDate: [
      { date: '2026-10-01', rooms: [{ id: 1, nameEn: 'Conference Room A', availableHours: [10] }] },
      { date: '2026-10-02', rooms: [{ id: 2, nameEn: 'Conference Room B', availableHours: [11] }] },
    ],
  });

  assert.equal(modal.callback_id, 'performance_meeting_slots_submit');
  assert.equal(modal.blocks.filter((block) => block.type === 'input').length, 2);
});
