const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('does not schedule public leave announcements in general or social channels', () => {
  const schedulerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'schedulers', 'jobs.js'),
    'utf8',
  );

  assert.doesNotMatch(schedulerSource, /getApprovedLeavesStartingToday/);
  assert.doesNotMatch(schedulerSource, /SOCIAL_CHANNEL_ID/);
  assert.doesNotMatch(schedulerSource, /out-of-office|OOO/i);
  assert.match(schedulerSource, /getUpcomingHolidays/);
});
