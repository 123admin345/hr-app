const ANNUAL_FRAMEWORK_VERSION = 'saudi-htc-annual-v1';

// These labels, sections, and descriptions reproduce the CEO-approved
// Saudi HTC Annual Performance Review & Growth Plan document.
const SAUDI_HTC_VALUES = [
  {
    key: 'buildFuture',
    label: 'Value 1: Build the Future',
    description: 'Proactively seeks innovative solutions; contributes to long-term strategic goals; aligns work with Saudi Vision 2030 healthcare objectives.',
  },
  {
    key: 'carefulBold',
    label: 'Value 2: Be Careful Be Bold',
    description: 'Takes calculated risks; makes data-driven decisions; speaks up with new ideas while considering potential consequences.',
  },
  {
    key: 'clearReal',
    label: 'Value 3: Be Clear Be Real',
    description: 'Communicates with transparency and honesty; provides constructive feedback; admits mistakes and learns from them.',
  },
  {
    key: 'excellent',
    label: 'Value 4: Be Excellent',
    description: 'Delivers high-quality work that exceeds standards; continuously seeks to improve skills and processes; demonstrates expertise.',
  },
  {
    key: 'worldClassTalent',
    label: 'Value 5: Build World Class Talent',
    description: 'Actively shares knowledge and mentors others; seeks and provides feedback for growth; invests in personal and professional development.',
  },
];

const VALUE_SCORE_LABELS = {
  5: 'Visionary - Inspires others and finds new ways to apply this value',
  4: 'Exceeds - Consistently exceeds expectations; role model',
  3: 'Meets - Consistently demonstrates expected behaviors',
  2: 'Inconsistent - Sometimes meets expectations',
  1: 'Needs Development - Consistently fails to meet expectations',
};

const VALUE_RATING_SCALE_TEXT = [5, 4, 3, 2, 1]
  .map((score) => `${score} — ${VALUE_SCORE_LABELS[score]}`)
  .join('\n');

const OVERALL_RATING_LABELS = {
  5: 'Exceptional - Consistently exceeds all expectations; role model for the organization',
  4: 'Exceeds Expectations - Frequently exceeds expectations; strong performer',
  3: 'Meets Expectations - Consistently meets expectations; solid contributor',
  2: 'Needs Improvement - Sometimes meets expectations; development needed',
  1: 'Unsatisfactory - Does not meet expectations; immediate action required',
};

// Slack static-select option text is limited to 75 characters. The full
// CEO-approved definitions remain visible beside the selectors in the form;
// these concise labels only make the dropdown payload valid for Slack.
const OVERALL_RATING_OPTION_LABELS = {
  5: '5 - Exceptional',
  4: '4 - Exceeds Expectations',
  3: '3 - Meets Expectations',
  2: '2 - Needs Improvement',
  1: '1 - Unsatisfactory',
};

const KEEPER_OPTIONS = [
  {
    value: 'Top Talent',
    label: 'Top Talent - Yes, absolutely. I would fight to keep them.',
  },
  {
    value: 'Valuable Contributor',
    label: 'Valuable Contributor - Yes, with some conditions. I would be disappointed if they left.',
  },
  {
    value: 'Performance Issue',
    label: 'Performance Issue - No, I would accept their resignation.',
  },
];

function isAnnualFramework(review) {
  return review?.reviewType === 'Annual' || review?.frameworkVersion === ANNUAL_FRAMEWORK_VERSION;
}

function valueScoreLabel(score) {
  return VALUE_SCORE_LABELS[Number(score)] || 'Not Rated';
}

function overallRatingLabel(score) {
  return OVERALL_RATING_LABELS[Number(score)] || 'Not Rated';
}

function getValueScoreOptions() {
  return [5, 4, 3, 2, 1].map((score) => ({
    text: { type: 'plain_text', text: `${score} - ${valueScoreLabel(score)}`, emoji: true },
    value: String(score),
  }));
}

function getOverallRatingOptions() {
  return [5, 4, 3, 2, 1].map((score) => ({
    text: { type: 'plain_text', text: OVERALL_RATING_OPTION_LABELS[score], emoji: true },
    value: String(score),
  }));
}

function getKeeperOptions() {
  return KEEPER_OPTIONS.map((option) => ({
    text: { type: 'plain_text', text: option.value, emoji: true },
    value: option.value,
  }));
}

function getOkrScoreOptions() {
  return ['0', '0.25', '0.5', '0.75', '1.0'].map((score) => ({
    text: { type: 'plain_text', text: score, emoji: true },
    value: score === '1.0' ? '1' : score,
  }));
}

function getOneToFiveScoreOptions() {
  return [1, 2, 3, 4, 5].map((score) => ({
    text: { type: 'plain_text', text: String(score), emoji: true },
    value: String(score),
  }));
}

function averageScores(scores, categories = SAUDI_HTC_VALUES) {
  const values = categories.map(({ key }) => Number(scores?.[key]));
  if (values.some((score) => !Number.isInteger(score) || score < 1 || score > 5)) {
    throw new Error('Every Saudi HTC value must be rated from 1 to 5.');
  }
  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}

function averageObjectiveScores(objectives = []) {
  const scores = objectives.map((objective) => Number(objective.score));
  if (!scores.length || scores.some((score) => !Number.isFinite(score) || score < 0 || score > 1)) {
    return null;
  }
  return Number((scores.reduce((total, score) => total + score, 0) / scores.length).toFixed(2));
}

function formatObjectiveLines(objectives = []) {
  return objectives.length
    ? objectives.map((objective, index) => `*Objective ${index + 1}:* ${objective.title || '—'}\n*Key Results:* ${objective.keyResults || '—'}\n*Target:* ${objective.target || '—'}\n*Actual:* ${objective.actual || '—'}\n*Score:* ${Number.isFinite(Number(objective.score)) ? Number(objective.score).toFixed(2) : '—'} / 1.0`).join('\n\n')
    : '—';
}

function formatSaudiHtcSelfAssessment(scores = {}, comments = '') {
  const objectives = scores.objectives || [];
  const averageOkr = averageObjectiveScores(objectives);
  const values = scores.values || {};
  const valueLines = SAUDI_HTC_VALUES
    .map(({ key, label }) => `• *${label}:* ${values[key] || '—'}${values[key] ? ` (${valueScoreLabel(values[key])})` : ''}`)
    .join('\n');
  const reflections = scores.reflections || {};
  const objectivesSection = objectives.length
    ? `*Part 1: Performance Against Objectives (The "What") — Employee Self-Report*\n${formatObjectiveLines(objectives)}\n\n*Average OKR Score:* ${averageOkr ?? '—'} / 1.0\n\n`
    : '';
  return `${objectivesSection}*Part 2: Living Our Values (The "How") — Saudi HTC 5Bs Self-Rating*\n*Rating scale:*\n${VALUE_RATING_SCALE_TEXT}\n\n${valueLines}\n\n*Part 5: Employee Self-Reflection*\n*1. What accomplishment are you most proud of during this review period, and how did it align with our values?*\n${reflections.accomplishment || '—'}\n\n*2. What was your biggest challenge, and what did you learn from it?*\n${reflections.challenge || '—'}\n\n*3. What support or resources do you need from management to be more effective in the next period?*\n${reflections.support || '—'}${comments ? `\n\n*Employee Comments (Optional):*\n${comments}` : ''}`;
}

function formatSaudiHtcManagerAssessment(scores = {}, comments = '', { objectivesOwner = 'manager', employeeObjectives = [] } = {}) {
  const objectives = objectivesOwner === 'employee' ? employeeObjectives : scores.objectives || [];
  const objectiveLines = formatObjectiveLines(objectives);
  const values = scores.values || {};
  const observations = scores.valueObservations || {};
  const valueLines = SAUDI_HTC_VALUES
    .map(({ key, label }) => `• *${label}:* ${values[key] || '—'}${values[key] ? ` (${valueScoreLabel(values[key])})` : ''}\n*Observations & Examples:* ${observations[key] || '—'}`)
    .join('\n\n');
  const averageOkr = averageObjectiveScores(objectives);
  const averageValues = Object.keys(values).length === SAUDI_HTC_VALUES.length ? averageScores(values) : null;
  const objectiveHeading = objectivesOwner === 'employee'
    ? '*Part 1: Performance Against Objectives (The "What") — Employee Self-Reported Objectives*'
    : '*Part 1: Performance Against Objectives (The "What")*';
  const resultsCommentary = scores.resultsCommentary
    || (objectivesOwner === 'employee' ? 'Manager commentary will be recorded after the appraisal discussion.' : '—');
  return `${objectiveHeading}\n${objectiveLines}\n\n*Average OKR Score:* ${averageOkr ?? '—'} / 1.0\n\n*Manager Commentary on Results*\n${resultsCommentary}\n\n*Part 2: Living Our Values (The "How") — Saudi HTC 5Bs Manager Rating*\n*Rating scale:*\n${VALUE_RATING_SCALE_TEXT}\n\n${valueLines}\n\n*Average Values Score:* ${averageValues ?? '—'} / 5${comments ? `\n\n*Manager Commentary / Rationale:*\n${comments}` : ''}`;
}

function formatAnnualFinalAssessment(finalAssessment = {}, { objectives = [], objectivesOwner = '' } = {}) {
  const project = finalAssessment.project || {};
  const feedback = finalAssessment.feedback360 || {};
  const goals = finalAssessment.developmentGoals || [];
  const goalText = goals
    .filter((goal) => goal.skill || goal.actionSteps || goal.timeline || goal.clickUpTaskId)
    .map((goal, index) => `${index + 1}. *Skill/Area to Improve:* ${goal.skill || '—'}\n   *Action Steps:* ${goal.actionSteps || '—'}\n   *Timeline:* ${goal.timeline || '—'}\n   *ClickUp Task ID:* ${goal.clickUpTaskId || '—'}`)
    .join('\n\n') || '—';
  const resultsCommentarySection = finalAssessment.resultsCommentary
    ? `*Part 1: Performance Against Objectives (The "What")*${objectivesOwner === 'employee' ? ' — Employee Self-Reported Objectives' : ''}\n${objectives.length ? `${formatObjectiveLines(objectives)}\n\n*Average OKR Score:* ${averageObjectiveScores(objectives) ?? '—'} / 1.0\n\n` : ''}*Manager Commentary on Results*\n${finalAssessment.resultsCommentary}\n\n`
    : '';
  return `${resultsCommentarySection}*Part 3: Project-Based Performance*\n*Project Name:* ${project.name || '—'}\n*Role:* ${project.role || '—'}\n*Key Contributions:* ${project.contribution || '—'}\n*Client Feedback:* ${project.clientFeedback || '—'}\n*Rating:* ${project.score || '—'} / 5\n*Average Project Score:* ${project.averageScore || '—'} / 5\n\n*Part 4: 360-Degree Feedback Summary*\n*Strengths Identified by Peers:*\n${feedback.strengths || '—'}\n\n*Areas for Growth Identified by Peers:*\n${feedback.areasForGrowth || '—'}\n\n*Part 6: Overall Performance Assessment*\n*Overall Score:* ${finalAssessment.overallScore || '—'} / 5\n*360 Feedback Score:* ${feedback.score || '—'} / 5\n*Overall Performance Rating:* ${finalAssessment.overallRating || '—'}${finalAssessment.overallRating ? ` — ${overallRatingLabel(finalAssessment.overallRating)}` : ''}\n*Manager Rationale for Overall Rating:*\n${finalAssessment.managerRationale || '—'}\n\n*"Keeper" Assessment:* ${finalAssessment.keeperAssessment || '—'}\n*Keeper Rationale:*\n${finalAssessment.keeperRationale || '—'}\n\n*Part 7: Growth & Development Plan*\n*Short-term (Next 12 months):* ${finalAssessment.careerShortTerm || '—'}\n*Long-term (Next 3-5 years):* ${finalAssessment.careerLongTerm || '—'}\n\n*Actionable Development Goals*\n${goalText}\n\n*Part 8: Core Message*\n${finalAssessment.coreMessage || '—'}\n\n*Part 9: Signatures*\n*Manager Signature:* ${finalAssessment.managerSignature || '—'}\n*Date of Review:* ${finalAssessment.reviewDate || '—'}\n*Employee Signature:* ${finalAssessment.employeeSignature || '—'}\n*Employee Signature Date:* ${finalAssessment.employeeSignatureDate || '—'}\n*Employee Comments (Optional):*\n${finalAssessment.employeeComments || '—'}`;
}

module.exports = {
  ANNUAL_FRAMEWORK_VERSION,
  SAUDI_HTC_VALUES,
  VALUE_SCORE_LABELS,
  VALUE_RATING_SCALE_TEXT,
  OVERALL_RATING_LABELS,
  OVERALL_RATING_OPTION_LABELS,
  KEEPER_OPTIONS,
  isAnnualFramework,
  valueScoreLabel,
  overallRatingLabel,
  getValueScoreOptions,
  getOverallRatingOptions,
  getKeeperOptions,
  getOkrScoreOptions,
  getOneToFiveScoreOptions,
  averageScores,
  averageObjectiveScores,
  formatSaudiHtcSelfAssessment,
  formatSaudiHtcManagerAssessment,
  formatAnnualFinalAssessment,
};
