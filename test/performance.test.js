const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOverallRating, scoreLabel } = require('../src/utils/performance');
const { addBusinessDays } = require('../src/utils/dates');
const {
  buildStartReviewModal,
  buildAssessmentModal,
  buildMeetingDateModal,
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
  const dateModal = buildMeetingDateModal({
    caseId: 'PERF-TEST',
    employeeName: 'Sample Employee',
    discussionDeadline: '31 October 2026',
  });
  const modal = buildMeetingSlotsModal({
    caseId: 'PERF-TEST',
    employeeName: 'Sample Employee',
    availabilityByDate: [
      { date: '2026-10-01', rooms: [{ id: 1, nameEn: 'Conference Room A', availableHours: [10] }] },
      { date: '2026-10-02', rooms: [{ id: 2, nameEn: 'Conference Room B', availableHours: [11] }] },
    ],
  });

  assert.equal(dateModal.title.text, 'Schedule Meeting');
  assert.ok(dateModal.title.text.length < 25);
  assert.equal(modal.callback_id, 'performance_meeting_slots_submit');
  assert.equal(modal.blocks.filter((block) => block.type === 'input').length, 2);
});

test('keeps every static Slack modal title below the 25-character limit', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const modalFiles = [
    'leaveCancellationModal.js', 'leaveRequestModal.js', 'performanceReviewModal.js',
    'rejectModal.js', 'salaryRaiseModal.js', 'saudiHtcPerformanceModal.js', 'visaRequestModal.js',
  ];
  const longStaticTitles = [];
  for (const filename of modalFiles) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'modals', filename), 'utf8');
    for (const match of source.matchAll(/title:\s*\{\s*type:\s*'plain_text',\s*text:\s*'([^']+)'/g)) {
      if (match[1].length >= 25) longStaticTitles.push(`${filename}: ${match[1]}`);
    }
  }
  assert.deepEqual(longStaticTitles, []);
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

test('catches up overdue performance-review deadlines when the Render service starts', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'performanceReviewHandler.js'), 'utf8');

  assert.match(indexSource, /processPerformanceReviewDeadlines/);
  assert.match(indexSource, /await processPerformanceReviewDeadlines\(app\.client\)/);
  assert.match(handlerSource, /review\.status === 'Discussion Open' && review\.discussionDueDate < today/);
  assert.match(handlerSource, /Annual review ready for final sections/);
  assert.match(handlerSource, /Complete Annual Review & Growth Plan/);
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

test('closes meeting option submission immediately before slow Sheets writes and employee delivery', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'performanceReviewHandler.js'), 'utf8');
  const submitStart = handlerSource.indexOf("app.view('performance_meeting_slots_submit'");
  const ackStart = handlerSource.indexOf('await ack();', submitStart);
  const lookupStart = handlerSource.indexOf('getPerformanceReviewCase(caseId)', submitStart);

  assert.ok(submitStart >= 0);
  assert.ok(ackStart > submitStart && ackStart < lookupStart);
  assert.match(handlerSource, /Meeting options have been sent to \$\{review\.employeeName\}/);
  assert.match(handlerSource, /Unable to send meeting options: \$\{error\.message/);
  assert.doesNotMatch(handlerSource, /buildMeetingOptionsSentModal/);
});

test('gives every employee meeting-choice button a unique Slack action ID', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'performanceReviewHandler.js'), 'utf8');

  assert.match(handlerSource, /action_id: `select_performance_meeting_option_\$\{index \+ 1\}`/);
  assert.match(handlerSource, /app\.action\(\/\^select_performance_meeting_option_\\d\+\$\//);
  assert.doesNotMatch(handlerSource, /action_id: 'select_performance_meeting'/);
});

test('uses unique Slack IDs for meeting-status buttons and finalizes overdue annual reviews first', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'performanceReviewHandler.js'), 'utf8');

  const employeeActionIds = [
    'employee_meeting_status_completed',
    'employee_meeting_status_not_held',
    'employee_meeting_status_manager_absent',
    'employee_meeting_status_need_hr_support',
  ];
  const managerActionIds = [
    'manager_meeting_status_completed',
    'manager_meeting_status_employee_absent',
    'manager_meeting_status_rescheduled',
    'manager_meeting_status_need_hr_support',
  ];

  for (const actionId of [...employeeActionIds, ...managerActionIds]) {
    assert.match(handlerSource, new RegExp(`action_id: '${actionId}'`));
  }
  assert.match(handlerSource, /app\.action\(\/\^employee_meeting_status_\(completed\|not_held\|manager_absent\|need_hr_support\)\$\//);
  assert.match(handlerSource, /app\.action\(\/\^manager_meeting_status_\(completed\|employee_absent\|rescheduled\|need_hr_support\)\$\//);
  assert.match(handlerSource, /review\.discussionDueDate >= today && !auditTypes\.has\('meeting_status_check_sent'\)/);
  assert.doesNotMatch(handlerSource, /action_id: 'employee_meeting_status'/);
  assert.doesNotMatch(handlerSource, /action_id: 'manager_meeting_status'/);
});
