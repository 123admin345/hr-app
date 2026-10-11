const SCORE_LABELS = {
  1: 'Below Expectations',
  2: 'Needs Improvement',
  3: 'Meets Expectations',
  4: 'Exceeds Expectations',
  5: 'Outstanding',
};

const PERFORMANCE_CATEGORIES = [
  { key: 'quality', label: 'Quality of Work', description: 'Accuracy, consistency, and standard of delivered work.' },
  { key: 'results', label: 'Role-Specific Results / KPIs', description: 'Delivery of role responsibilities, targets, and agreed results.' },
  { key: 'accountability', label: 'Accountability', description: 'Ownership, reliability, follow-through, and problem solving.' },
  { key: 'collaboration', label: 'Collaboration', description: 'Teamwork, support for colleagues, and constructive contribution.' },
  { key: 'communication', label: 'Communication', description: 'Clarity, responsiveness, and professional communication.' },
  { key: 'conduct', label: 'Professional Conduct & Attendance', description: 'Professional behaviour, punctuality, and adherence to company standards.' },
];

function scoreLabel(score) {
  return SCORE_LABELS[Number(score)] || 'Not Rated';
}

function getScoreOptions() {
  return [1, 2, 3, 4, 5].map((score) => ({
    text: { type: 'plain_text', text: `${score} — ${scoreLabel(score)}`, emoji: true },
    value: String(score),
  }));
}

function calculateOverallRating(scores) {
  const values = PERFORMANCE_CATEGORIES.map(({ key }) => Number(scores?.[key]));
  if (values.some((score) => !Number.isInteger(score) || score < 1 || score > 5)) {
    throw new Error('Each performance category must be rated from 1 to 5.');
  }
  const average = values.reduce((total, score) => total + score, 0) / values.length;
  const overall = Math.round(average);
  return { average: Number(average.toFixed(2)), overall, label: scoreLabel(overall) };
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function formatAssessment(scores = {}, overall, comments = '') {
  const categoryLines = PERFORMANCE_CATEGORIES
    .map(({ key, label }) => `• *${label}:* ${scores[key] || '—'}${scores[key] ? ` (${scoreLabel(scores[key])})` : ''}`)
    .join('\n');
  const summary = overall ? `*Overall Rating:* *${overall}/5 — ${scoreLabel(overall)}*` : '*Overall Rating:* Not submitted';
  return `${summary}\n${categoryLines}${comments ? `\n\n*Comments:*\n${comments}` : ''}`;
}

module.exports = {
  SCORE_LABELS,
  PERFORMANCE_CATEGORIES,
  scoreLabel,
  getScoreOptions,
  calculateOverallRating,
  safeJson,
  formatAssessment,
};
