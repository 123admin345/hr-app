const DEFAULT_HR_MANAGER_ID = 'U0ASG55FV0W';

function splitSlackIds(value = '') {
  return String(value)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * HR users who may start and administer performance reviews.
 *
 * PERFORMANCE_HR_STARTER_IDS is the preferred performance-review setting.
 * VISA_HR_APPROVER_IDS is deliberately included so that existing HR users who
 * are already authorised for the visa module do not need to be configured twice.
 */
function isPerformanceHrUser(userId, env = process.env) {
  const hrManager = env.HR_MANAGER_ID || DEFAULT_HR_MANAGER_ID;
  const owner = env.OWNER_SLACK_ID || '';
  const authorizedIds = new Set([
    hrManager,
    owner,
    ...splitSlackIds(env.ADMIN_SLACK_IDS),
    ...splitSlackIds(env.PERFORMANCE_HR_STARTER_IDS),
    ...splitSlackIds(env.VISA_HR_APPROVER_IDS),
  ].filter(Boolean));
  return authorizedIds.has(userId);
}

module.exports = {
  splitSlackIds,
  isPerformanceHrUser,
};
