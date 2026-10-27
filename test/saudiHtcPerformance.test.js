const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ANNUAL_FRAMEWORK_VERSION,
  SAUDI_HTC_VALUES,
  VALUE_SCORE_LABELS,
  VALUE_RATING_SCALE_TEXT,
  OVERALL_RATING_LABELS,
  KEEPER_OPTIONS,
  averageScores,
  averageObjectiveScores,
  formatSaudiHtcManagerAssessment,
  formatAnnualFinalAssessment,
} = require('../src/utils/saudiHtcPerformance');
const {
  buildSaudiHtcAssessmentModal,
  buildSaudiHtcFinalReviewModal,
  buildSaudiHtcEmployeeSignatureModal,
} = require('../src/modals/saudiHtcPerformanceModal');

const valueScores = Object.fromEntries(SAUDI_HTC_VALUES.map(({ key }) => [key, 4]));

function findBlock(modal, blockId) {
  return modal.blocks.find((block) => block.block_id === blockId);
}

test('uses the exact approved Saudi HTC value, overall rating, and keeper labels', () => {
  assert.equal(VALUE_SCORE_LABELS[5], 'Visionary - Inspires others and finds new ways to apply this value');
  assert.equal(VALUE_SCORE_LABELS[1], 'Needs Development - Consistently fails to meet expectations');
  assert.equal(OVERALL_RATING_LABELS[5], 'Exceptional - Consistently exceeds all expectations; role model for the organization');
  assert.equal(OVERALL_RATING_LABELS[1], 'Unsatisfactory - Does not meet expectations; immediate action required');
  assert.deepEqual(KEEPER_OPTIONS.map((option) => option.value), ['Top Talent', 'Valuable Contributor', 'Performance Issue']);
  assert.match(VALUE_RATING_SCALE_TEXT, /5 — Visionary/);
  assert.match(VALUE_RATING_SCALE_TEXT, /1 — Needs Development/);
  assert.equal(SAUDI_HTC_VALUES.length, 5);
  SAUDI_HTC_VALUES.forEach((value) => assert.ok(value.description));
  assert.equal(averageScores(valueScores), 4);
  assert.equal(averageObjectiveScores([{ score: 1 }, { score: 0.5 }, { score: 0.75 }]), 0.75);
});

test('routes first annual objectives to the employee and later annual objectives to the manager', () => {
  const shared = {
    caseId: 'PERF-ANNUAL-TEST', employeeName: 'Sample Employee', jobTitle: 'Analyst',
    department: 'Operations', managerSlackId: 'U-MANAGER', reviewPeriod: '1 January – 31 December 2026',
    reviewDate: '27 September 2026', initialDueDate: '7 October 2026',
  };
  const firstEmployeeModal = buildSaudiHtcAssessmentModal({ ...shared, role: 'employee', objectivesOwner: 'employee' });
  const firstManagerModal = buildSaudiHtcAssessmentModal({ ...shared, role: 'manager', objectivesOwner: 'employee' });
  const laterEmployeeModal = buildSaudiHtcAssessmentModal({ ...shared, role: 'employee', objectivesOwner: 'manager' });
  const laterManagerModal = buildSaudiHtcAssessmentModal({ ...shared, role: 'manager', objectivesOwner: 'manager' });

  assert.equal(firstEmployeeModal.callback_id, 'performance_assessment_submit');
  assert.equal(firstManagerModal.callback_id, 'performance_assessment_submit');
  assert.ok(findBlock(firstEmployeeModal, 'annual_okr_1_title'));
  assert.ok(findBlock(firstEmployeeModal, 'annual_okr_1_key_results'));
  assert.ok(findBlock(firstEmployeeModal, 'annual_self_value_buildFuture'));
  assert.ok(findBlock(firstEmployeeModal, 'annual_self_accomplishment'));
  assert.equal(findBlock(firstManagerModal, 'annual_okr_1_title'), undefined);
  assert.ok(findBlock(firstManagerModal, 'annual_manager_value_buildFuture_observation'));
  assert.equal(findBlock(laterEmployeeModal, 'annual_okr_1_title'), undefined);
  assert.ok(findBlock(laterManagerModal, 'annual_okr_1_title'));
  assert.ok(findBlock(laterManagerModal, 'annual_okr_1_key_results'));
  assert.ok(findBlock(laterManagerModal, 'annual_okr_1_target'));
  assert.ok(findBlock(laterManagerModal, 'annual_okr_1_actual'));
  assert.ok(findBlock(laterManagerModal, 'annual_okr_1_score'));
  assert.equal(findBlock(firstEmployeeModal, 'annual_self_overall'), undefined);
  assert.equal(findBlock(firstEmployeeModal, 'annual_career_short_term'), undefined);
  assert.equal(findBlock(firstManagerModal, 'annual_360_score'), undefined);
  assert.equal(findBlock(firstManagerModal, 'annual_keeper_assessment'), undefined);
  assert.match(firstEmployeeModal.blocks.find((block) => block.type === 'section' && block.text?.text.includes('Saudi HTC 5Bs')).text.text, /Rating scale/);
});

test('builds all remaining approved annual review sections for manager signature', () => {
  const modal = buildSaudiHtcFinalReviewModal({
    caseId: 'PERF-ANNUAL-TEST', employeeName: 'Sample Employee', jobTitle: 'Analyst',
    department: 'Operations', managerSlackId: 'U-MANAGER', reviewPeriod: '2026', reviewDate: '27 September 2026',
  });

  assert.equal(modal.callback_id, 'performance_final_decision_submit');
  assert.ok(findBlock(modal, 'annual_project_name'));
  assert.ok(findBlock(modal, 'annual_average_project_score'));
  assert.ok(findBlock(modal, 'annual_360_strengths'));
  assert.ok(findBlock(modal, 'annual_360_growth'));
  assert.ok(findBlock(modal, 'annual_360_score'));
  assert.ok(findBlock(modal, 'annual_overall_score'));
  assert.ok(findBlock(modal, 'annual_overall_rating'));
  assert.ok(findBlock(modal, 'annual_manager_rationale'));
  assert.ok(findBlock(modal, 'annual_keeper_assessment'));
  assert.ok(findBlock(modal, 'annual_keeper_rationale'));
  assert.ok(findBlock(modal, 'annual_growth_short_term'));
  assert.ok(findBlock(modal, 'annual_goal_1_skill'));
  assert.ok(findBlock(modal, 'annual_goal_3_clickup'));
  assert.ok(findBlock(modal, 'annual_core_message'));
  assert.ok(findBlock(modal, 'annual_manager_signature'));
});

test('puts manager commentary on employee-entered first-review objectives in the final manager stage', () => {
  const firstAnnualModal = buildSaudiHtcFinalReviewModal({
    caseId: 'PERF-ANNUAL-FIRST', objectivesOwner: 'employee', employeeName: 'Sample Employee', jobTitle: 'Analyst',
    department: 'Operations', managerSlackId: 'U-MANAGER', reviewPeriod: '2026', reviewDate: '11 October 2026',
    employeeScores: { objectives: [{ title: 'First objective', keyResults: 'KR 1.1', target: '90%', actual: '95%', score: 1 }] },
  });
  const laterAnnualModal = buildSaudiHtcFinalReviewModal({
    caseId: 'PERF-ANNUAL-LATER', objectivesOwner: 'manager', employeeName: 'Sample Employee', jobTitle: 'Analyst',
    department: 'Operations', managerSlackId: 'U-MANAGER', reviewPeriod: '2027', reviewDate: '11 October 2027',
  });

  assert.ok(findBlock(firstAnnualModal, 'annual_results_commentary'));
  assert.equal(findBlock(laterAnnualModal, 'annual_results_commentary'), undefined);
  assert.match(firstAnnualModal.blocks.find((block) => block.type === 'section' && block.text?.text.includes('Employee Self-Reported Objectives')).text.text, /First objective/);
});

test('collects employee signature and optional comments as the approved final section', () => {
  const modal = buildSaudiHtcEmployeeSignatureModal({ caseId: 'PERF-ANNUAL-TEST', employeeName: 'Sample Employee' });
  assert.equal(modal.callback_id, 'annual_employee_signature_submit');
  assert.ok(findBlock(modal, 'annual_employee_signature'));
  assert.ok(findBlock(modal, 'annual_employee_comments_final'));
});

test('formats the CEO-approved annual record without app-generated rating or reweighting', () => {
  const managerSummary = formatSaudiHtcManagerAssessment({
    objectives: [{ title: 'Improve service quality', keyResults: 'KR 1.1', target: '90%', actual: '95%', score: 1 }],
    values: valueScores,
    valueObservations: { buildFuture: 'Led an improvement initiative.' },
    resultsCommentary: 'Focused on the right priorities.',
  });
  const finalSummary = formatAnnualFinalAssessment({
    project: { name: 'Project A', role: 'Lead', contribution: 'Delivered milestone', clientFeedback: 'Positive', score: 4, averageScore: '4.0' },
    feedback360: { score: 4, strengths: '1. Collaboration', areasForGrowth: '1. Delegation' },
    overallScore: '4.1', overallRating: 4, managerRationale: 'Strong performer.',
    keeperAssessment: 'Top Talent', keeperRationale: 'Key contributor.',
    careerShortTerm: 'Lead a workstream', careerLongTerm: 'Become a department leader',
    developmentGoals: [{ skill: 'Leadership', actionSteps: 'Lead a project', timeline: 'December 2027', clickUpTaskId: 'HTC-123' }],
    coreMessage: 'Strong year with a focus on leadership.', managerSignature: 'Manager Name', reviewDate: '27 September 2026',
    employeeSignature: 'Employee Name', employeeSignatureDate: '28 September 2026', employeeComments: 'Thank you.',
    resultsCommentary: 'Focused on the right priorities after the discussion.',
  }, {
    objectivesOwner: 'employee',
    objectives: [{ title: 'Employee first-year objective', keyResults: 'KR 1.1', target: '90%', actual: '95%', score: 1 }],
  });

  assert.match(managerSummary, /Key Results:/);
  assert.match(managerSummary, /Average OKR Score:/);
  assert.match(managerSummary, /Average Values Score:/);
  assert.match(finalSummary, /Average Project Score:/);
  assert.match(finalSummary, /Employee Self-Reported Objectives/);
  assert.match(finalSummary, /Employee first-year objective/);
  assert.match(finalSummary, /Focused on the right priorities after the discussion/);
  assert.match(finalSummary, /\*Overall Score:\* 4.1 \/ 5/);
  assert.match(finalSummary, /Top Talent/);
  assert.match(finalSummary, /HTC-123/);
  assert.match(finalSummary, /\*Employee Signature:\* Employee Name/);
  assert.doesNotMatch(finalSummary, /reweight/i);
  assert.doesNotMatch(finalSummary, /weighted score/i);
});

test('stores annual framework version and prevents expired modal trigger delays', () => {
  const sheetsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'sheets.js'), 'utf8');
  const handlerSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'handlers', 'performanceReviewHandler.js'), 'utf8');
  const annualUtilsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'saudiHtcPerformance.js'), 'utf8');
  const annualModalSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'modals', 'saudiHtcPerformanceModal.js'), 'utf8');

  assert.match(sheetsSource, /frameworkVersion: 'AF'/);
  assert.match(sheetsSource, /Performance Reviews!A:AG/);
  assert.match(sheetsSource, /reviewPeriod: 'AG'/);
  assert.match(sheetsSource, /Awaiting Employee Signature/);
  assert.match(handlerSource, /buildLoadingReviewModal/);
  assert.match(handlerSource, /client\.views\.open\(\{ trigger_id: triggerId, view: buildLoadingReviewModal\(\) \}\)/);
  assert.match(handlerSource, /annual_employee_signature_submit/);
  assert.match(handlerSource, /getAnnualObjectivesOwner/);
  assert.match(handlerSource, /hasCompletedPriorAnnualReview/);
  assert.match(handlerSource, /annual-review form has been/);
  assert.doesNotMatch(handlerSource, /annualReview \? \{ overall: assessment\.overall, label: scoreLabel\(assessment\.overall\) \}/);
  assert.doesNotMatch(annualUtilsSource, /reweight|weighted score|automatic.*rating/i);
  assert.doesNotMatch(annualModalSource, /Not applicable|self-overall|reweight|automatic.*rating/i);
  assert.equal(ANNUAL_FRAMEWORK_VERSION, 'saudi-htc-annual-v1');
});
