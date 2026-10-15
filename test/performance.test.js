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
const {
  performanceReviewDataStartRow,
  normalizePerformanceCaseId,
  hasCorrectPerformanceHeaders,
  nextPerformanceReviewRow,
  isOrphanedPerformanceReviewStart,
} = require('../src/utils/sheets');

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
  const headers = [
    'Case ID', 'Review Type', 'Opened At', 'Initial Submission Deadline', 'Discussion Deadline', 'Status',
    'Employee Name', 'Employee Slack ID', 'Manager Slack ID', 'Contract End Date', 'Annual Leave Balance',
    'Employee Category Scores', 'Employee Overall Rating', 'Employee Comments', 'Employee Submitted At',
    'Manager Category Scores', 'Manager Overall Rating', 'Manager Comments', 'Manager Submitted At',
    'Proposed Meeting Options', 'Confirmed Meeting', 'Employee Meeting Status', 'Manager Meeting Status',
    'Revision & Audit History', 'Final Rating', 'Renewal Outcome', 'Next Goals / KPIs', 'Final Manager Notes',
    'HR / CEO Decision Notes', 'Escalated At', 'Resolved At', 'Framework Version', 'Review Period',
  ];
  assert.equal(performanceReviewDataStartRow([headers]), 1);
  assert.equal(performanceReviewDataStartRow([['PERF-TEST', 'Annual']]), 0);
  assert.equal(performanceReviewDataStartRow([['Performance Review Record'], ['Case ID', 'Review Type']]), 2);
  assert.equal(performanceReviewDataStartRow([[]]), 0);
  assert.equal(performanceReviewDataStartRow([]), 0);
  assert.equal(normalizePerformanceCaseId(' PERF-TEST-001 '), 'PERF-TEST-001');
  assert.equal(hasCorrectPerformanceHeaders(headers), true);
  assert.equal(hasCorrectPerformanceHeaders(['Framework Version', 'Review Period']), false);
  assert.equal(nextPerformanceReviewRow([headers]), 2);
  assert.equal(nextPerformanceReviewRow([headers, ['', '', '', '', '', 'Initial Review Open']]), 3);
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

test('recovers a ready discussion stage and splits long Slack assessment summaries safely', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'performanceReviewHandler.js'), 'utf8');

  assert.match(handlerSource, /async function recoverReadyPerformanceDiscussions/);
  assert.match(handlerSource, /discussion_messages_sent/);
  assert.match(handlerSource, /markdownSectionBlocks/);
  assert.match(handlerSource, /await recoverReadyPerformanceDiscussions\(client\)/);
});

test('opens the meeting scheduler before slow confidential lookups can expire the Slack trigger', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'performanceReviewHandler.js'), 'utf8');
  const actionStart = handlerSource.indexOf("app.action('schedule_appraisal_meeting'");
  const lookupStart = handlerSource.indexOf('getPerformanceReviewCase(safeJson(action.value', actionStart);
  const openStart = handlerSource.indexOf('client.views.open({ trigger_id: body.trigger_id, view: buildLoadingMeetingModal() })', actionStart);

  assert.ok(actionStart >= 0);
  assert.ok(openStart > actionStart && openStart < lookupStart);
  assert.match(handlerSource, /response_action: 'update', view: buildLoadingMeetingModal\(\)/);
  assert.match(handlerSource, /client\.views\.update\(\{ view_id: body\.view\.id, view: buildMeetingSlotsModal/);
});

test('offers a fresh private meeting scheduler button after a sleeping service expires the original Slack trigger', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'performanceReviewHandler.js'), 'utf8');

  assert.match(handlerSource, /function isExpiredTriggerError/);
  assert.match(handlerSource, /function meetingSchedulerRetryMessage/);
  assert.match(handlerSource, /isExpiredTriggerError\(error\)/);
  assert.match(handlerSource, /Open Meeting Scheduler/);
});
