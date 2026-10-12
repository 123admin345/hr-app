const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOverallRating, scoreLabel } = require('../src/utils/performance');
const { addBusinessDays } = require('../src/utils/dates');
const {
  buildStartReviewModal,
  buildAssessmentModal,
  buildMeetingSlotsModal,
} = require('../src/modals/performanceReviewModal');
const { isPerformanceHrUser } = require('../src/utils/hrAuthorization');
const { performanceReviewDataStartRow, normalizePerformanceCaseId, isOrphanedPerformanceReviewStart } = require('../src/utils/sheets');

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

test('builds the start-review form and six-category assessment form', () => {
  const startModal = buildStartReviewModal();
  const hrStartModal = buildStartReviewModal({ requesterIsHr: true });
  const assessmentModal = buildAssessmentModal({
    caseId: 'PERF-TEST',
    role: 'employee',
    employeeName: 'Sample Employee',
    contractEndDate: '2026-12-31',
    initialDueDate: '2026-10-01',
  });

  assert.equal(startModal.callback_id, 'performance_start_review_submit');
  assert.equal(startModal.blocks.filter((block) => block.type === 'input').length, 3);
  assert.equal(startModal.blocks.some((block) => block.block_id === 'review_period'), true);
  assert.match(hrStartModal.blocks[0].text.text, /authorised HR user.*any registered employee/i);
  assert.equal(assessmentModal.callback_id, 'performance_assessment_submit');
  assert.equal(assessmentModal.blocks.filter((block) => block.block_id?.startsWith('score_')).length, 6);
});

test('authorises the HR manager and configured HR starters to start performance reviews for any employee', () => {
  const original = {
    HR_MANAGER_ID: process.env.HR_MANAGER_ID,
    OWNER_SLACK_ID: process.env.OWNER_SLACK_ID,
    ADMIN_SLACK_IDS: process.env.ADMIN_SLACK_IDS,
    PERFORMANCE_HR_STARTER_IDS: process.env.PERFORMANCE_HR_STARTER_IDS,
    VISA_HR_APPROVER_IDS: process.env.VISA_HR_APPROVER_IDS,
  };
  process.env.HR_MANAGER_ID = 'U-HR-MANAGER';
  process.env.OWNER_SLACK_ID = 'U-OWNER';
  process.env.ADMIN_SLACK_IDS = 'U-ADMIN';
  process.env.PERFORMANCE_HR_STARTER_IDS = 'U-HR-ONE,U-HR-TWO';
  process.env.VISA_HR_APPROVER_IDS = 'U-VISA-HR';

  assert.equal(isPerformanceHrUser('U-HR-MANAGER'), true);
  assert.equal(isPerformanceHrUser('U-HR-ONE'), true);
  assert.equal(isPerformanceHrUser('U-HR-TWO'), true);
  assert.equal(isPerformanceHrUser('U-VISA-HR'), true);
  assert.equal(isPerformanceHrUser('U-OWNER'), true);
  assert.equal(isPerformanceHrUser('U-ADMIN'), true);
  assert.equal(isPerformanceHrUser('U-MANAGER-ONLY'), false);

  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('finds performance review records whether the sheet header row is present or missing', () => {
  assert.equal(performanceReviewDataStartRow([['Case ID', 'Review Type']]), 1);
  assert.equal(performanceReviewDataStartRow([['PERF-TEST', 'Annual']]), 0);
  assert.equal(performanceReviewDataStartRow([['Performance Review Record'], ['Case ID', 'Review Type']]), 2);
  assert.equal(performanceReviewDataStartRow([[]]), 0);
  assert.equal(performanceReviewDataStartRow([]), 0);
  assert.equal(normalizePerformanceCaseId(' PERF-TEST-001 '), 'PERF-TEST-001');
});

test('identifies only empty-audit opening rows as failed review starts', () => {
  assert.equal(isOrphanedPerformanceReviewStart({ status: 'Initial Review Open', revisionAudit: [] }), true);
  assert.equal(isOrphanedPerformanceReviewStart({ status: 'Initial Review Open', revisionAudit: [{ type: 'case_opened' }] }), false);
  assert.equal(isOrphanedPerformanceReviewStart({ status: 'Discussion Open', revisionAudit: [] }), false);
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
