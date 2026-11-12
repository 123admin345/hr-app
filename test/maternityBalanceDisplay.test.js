const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const {
  isEmployeeCancelableLeave,
  restoredLeaveBalances,
  cancellationSummaryForEmployee,
} = require('../src/utils/leaveCancellation');
const { processedDecisionBlocks } = require('../src/utils/leaveDecision');
const { SAFE_SECTION_TEXT_LENGTH } = require('../src/utils/slackBlocks');

// Run the real handlers with isolated external services, without contacting
// Google Sheets, posting to Slack, or starting any cron jobs.
function loadIsolatedModule(relativePath, dependencies, env = {}) {
  const filename = path.join(__dirname, relativePath);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: (name) => Object.prototype.hasOwnProperty.call(dependencies, name)
      ? dependencies[name]
      : localRequire(name),
    process: { env },
    console: { log() {}, error(error) { throw error; } },
  }, { filename });
  return module.exports;
}

function employee(overrides = {}) {
  return {
    name: 'Sample Employee',
    slackUserId: 'U-EMPLOYEE',
    annualTotal: 21,
    annualUsed: 8,
    annualRemaining: 13,
    sickUsed: 2,
    hajjUsed: 1,
    rolloverAllowed: false,
    ...overrides,
  };
}

async function balanceCommand(commandName, employees, userId = 'U-EMPLOYEE') {
  const commands = {};
  const sent = [];
  const { registerAdminHandlers } = loadIsolatedModule('../src/handlers/adminHandler.js', {
    '../utils/sheets': {
      getAllEmployees: async () => employees,
      getEmployeeBySlackId: async (id) => employees.find((record) => record.slackUserId === id),
    },
  }, { ADMIN_SLACK_IDS: 'U-HR' });
  registerAdminHandlers({ command(name, handler) { commands[name] = handler; } });
  let acknowledged = false;
  await commands[commandName]({
    command: { user_id: userId },
    ack: async () => { acknowledged = true; },
    client: {
      conversations: { open: async () => ({ channel: { id: 'D-PRIVATE' } }) },
      chat: { postMessage: async (payload) => { sent.push(payload); } },
    },
    logger: { error(error) { throw error; } },
  });
  assert.equal(acknowledged, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'D-PRIVATE');
  return sent[0];
}

function blockFields(message) {
  return message.blocks.flatMap((block) => block.fields || []);
}

test('my-balance displays cumulative approved maternity calendar days separately without inferring entitlement', async () => {
  const record = employee({ maternityUsed: 84 });
  const before = { ...record };
  const message = await balanceCommand('/my-balance', [record]);
  const fields = blockFields(message);
  const maternity = fields.find((field) => field.text.includes('Maternity Leave Recorded'));
  assert.equal(maternity.text, '*Maternity Leave Recorded*\n84 calendar day(s)');
  assert.ok(fields.some((field) => field.text.includes('13 days remaining')));
  assert.ok(fields.some((field) => field.text.includes('2 day(s) this year')));
  assert.ok(fields.some((field) => field.text.includes('Used ✅')));
  const notes = message.blocks.flatMap((block) => block.elements || []).map((element) => element.text).join('\n');
  assert.match(notes, /cumulative approved calendar days/);
  assert.match(notes, /separately from annual, sick, and Hajj leave/);
  assert.match(notes, /No entitlement or remaining balance is inferred/);
  assert.match(notes, /does not reset automatically/);
  assert.deepEqual(record, before);
});

test('my-balance treats a missing maternity record as zero calendar days', async () => {
  const message = await balanceCommand('/my-balance', [employee()]);
  const maternity = blockFields(message).find((field) => field.text.includes('Maternity Leave Recorded'));
  assert.equal(maternity.text, '*Maternity Leave Recorded*\n0 calendar day(s)');
});

test('hr-balance includes maternity calendar days and preserves legacy annual, sick, and Hajj balances', async () => {
  const message = await balanceCommand('/hr-balance', [
    employee({ maternityUsed: 84 }),
    employee({ name: 'Legacy Employee', slackUserId: 'U-LEGACY', hajjUsed: 0 }),
  ], 'U-HR');
  assert.match(message.text, /Maternity: 84 calendar days/);
  assert.match(message.text, /Maternity: 0 calendar days/);
  assert.match(message.text, /Annual 13\/21 days remaining \| Sick: 2 days \| Hajj: Used/);
  assert.match(message.text, /Hajj: Not used/);
});

test('hr-balance remains admin-only after adding maternity records', async () => {
  const message = await balanceCommand('/hr-balance', [employee({ maternityUsed: 84 })]);
  assert.match(message.text, /only available to HR admins/);
  assert.doesNotMatch(message.text, /Maternity/);
});

test('maternity cancellation removes calendar days without changing annual, sick, or Hajj balances', () => {
  const record = employee({ maternityUsed: 90 });
  const before = { ...record };
  const restored = restoredLeaveBalances(record, { leaveType: 'Maternity', totalDays: 84 });
  assert.deepEqual(restored, {
    maternityUsed: 6,
    summary: '84 maternity calendar day(s) removed from recorded balance; annual leave is unchanged',
  });
  assert.deepEqual(record, before);
  assert.equal(Object.hasOwn(restored, 'annualUsed'), false);
  assert.equal(Object.hasOwn(restored, 'annualRemaining'), false);
  assert.equal(Object.hasOwn(restored, 'sickUsed'), false);
  assert.equal(Object.hasOwn(restored, 'hajjUsed'), false);
  const summary = cancellationSummaryForEmployee({ leaveType: 'Maternity' }, restored);
  assert.match(summary, /\*6 calendar day\(s\)\*/);
  assert.match(summary, /annual leave balance is unchanged/);
  assert.doesNotMatch(summary, /Hajj leave eligibility/);
});

test('maternity cancellation clamps the cumulative record at zero and tolerates a missing record', () => {
  for (const record of [{ maternityUsed: 5 }, {}]) {
    const restored = restoredLeaveBalances(record, { leaveType: 'Maternity', totalDays: '84' });
    assert.equal(restored.maternityUsed, 0);
    assert.match(cancellationSummaryForEmployee({ leaveType: 'Maternity' }, restored), /0 calendar day\(s\)/);
  }
});

test('maternity self-cancellation remains restricted to the employee and a future approved start date', () => {
  const request = {
    status: 'Approved',
    leaveType: 'Maternity',
    slackUserId: 'U-EMPLOYEE',
    startDate: '2026-11-13',
    totalDays: 84,
  };
  const today = '2026-11-12';
  assert.equal(isEmployeeCancelableLeave(request, 'U-EMPLOYEE', today), true);
  assert.equal(isEmployeeCancelableLeave(request, 'U-OTHER', today), false);
  assert.equal(isEmployeeCancelableLeave({ ...request, startDate: today }, 'U-EMPLOYEE', today), false);
  assert.equal(isEmployeeCancelableLeave({ ...request, startDate: '2026-11-11' }, 'U-EMPLOYEE', today), false);
  assert.equal(isEmployeeCancelableLeave({ ...request, status: 'Pending' }, 'U-EMPLOYEE', today), false);
  assert.equal(isEmployeeCancelableLeave({ ...request, status: 'Cancelled' }, 'U-EMPLOYEE', today), false);
});

test('annual, sick, and Hajj cancellation restoration and employee summaries are unchanged', () => {
  const annual = restoredLeaveBalances(employee(), { leaveType: 'Annual', totalDays: 3 });
  assert.deepEqual(annual, { annualUsed: 5, annualRemaining: 16, summary: '3 annual leave day(s) restored' });
  assert.equal(cancellationSummaryForEmployee({ leaveType: 'Annual' }, annual), 'Your annual leave balance is now *16 day(s)*.');
  const sick = restoredLeaveBalances(employee(), { leaveType: 'Sick', totalDays: 3 });
  assert.deepEqual(sick, { sickUsed: 0, summary: '3 sick leave day(s) removed from used balance' });
  assert.equal(cancellationSummaryForEmployee({ leaveType: 'Sick' }, sick), 'Your sick leave used balance is now *0 day(s)*.');
  const hajj = restoredLeaveBalances(employee(), { leaveType: 'Hajj', totalDays: 10 });
  assert.deepEqual(hajj, { hajjUsed: 0, summary: 'Hajj leave eligibility restored' });
  assert.equal(cancellationSummaryForEmployee({ leaveType: 'Hajj' }, hajj), 'Your Hajj leave eligibility has been restored because the leave was cancelled before it started.');
  assert.throws(() => restoredLeaveBalances(employee(), { leaveType: 'Unknown', totalDays: 1 }), /Unsupported leave type/);
});

test('processed decisions use calendar duration for maternity and keep working-day duration for existing leave types', () => {
  const base = {
    status: 'Approved',
    slackUserId: 'U-EMPLOYEE',
    employeeName: 'Sample Employee',
    startDate: '2026-11-12',
    endDate: '2027-02-03',
    totalDays: 84,
    managerId: 'U-MANAGER',
  };
  for (const status of ['Approved', 'Rejected', 'Cancelled', 'Approval Processing', 'Pending Final Acknowledgement']) {
    const blocks = processedDecisionBlocks({ ...base, leaveType: 'Maternity', status });
    assert.match(blocks[0].text.text, /\*\(84 calendar day\(s\)\)\*/);
    assert.doesNotMatch(blocks[0].text.text, /working day/);
    assert.equal(blocks.some((block) => block.type === 'actions'), false);
  }
  for (const leaveType of ['Annual', 'Sick', 'Hajj']) {
    const blocks = processedDecisionBlocks({ ...base, leaveType, totalDays: 3 });
    assert.match(blocks[0].text.text, /\*\(3 working day\(s\)\)\*/);
  }
});

test('monthly report includes 40 maternity records in Slack-safe sections and leaves schedules and balances unchanged', async () => {
  const records = Array.from({ length: 40 }, (_, index) => employee({
    name: `Employee ${String(index).padStart(2, '0')} With A Representative Longer Name`,
    slackUserId: `U-EMPLOYEE-${index}`,
    annualRemaining: index % 22,
    annualUsed: index % 22 === 21 ? 0 : 21 - (index % 22),
    ...(index === 0 ? {} : { maternityUsed: index + 80 }),
  }));
  const before = records.map((record) => ({ ...record }));
  const schedules = [];
  const messages = [];
  const { registerScheduledJobs } = loadIsolatedModule('../src/schedulers/jobs.js', {
    'node-cron': {
      schedule(expression, callback, options) { schedules.push({ expression, callback, options }); },
    },
    '../utils/sheets': {
      getUpcomingHolidays: async () => [],
      getAllEmployees: async () => [...records],
    },
    '../handlers/performanceReviewHandler': {
      startPerformanceReviewCase: async () => {},
      openContractReviewsDue: async () => {},
      processPerformanceReviewDeadlines: async () => {},
      sendMonthlyPerformanceReport: async () => {},
    },
  }, { ADMIN_SLACK_IDS: 'U-HR', GENERAL_CHANNEL_ID: 'C-GENERAL' });
  registerScheduledJobs({ client: { chat: { postMessage: async (message) => { messages.push(message); } } } });
  assert.deepEqual(schedules.map((schedule) => schedule.expression), [
    '0 9 * * 0', '0 8 1 * *', '15 9 * * *', '30 9 1 6,12 *', '45 9 * * 0-4', '15 8 1 * *',
  ]);
  assert.ok(schedules.every((schedule) => schedule.options.timezone === 'Asia/Riyadh'));
  await schedules.find((schedule) => schedule.expression === '0 8 1 * *').callback();
  assert.equal(messages.length, 1);
  const message = messages[0];
  assert.equal(message.channel, 'U-HR');
  const sections = message.blocks.filter((block) => block.type === 'section' && block.text);
  assert.ok(sections.length > 1, '40-employee individual list should be split into multiple sections');
  assert.ok(message.blocks.length <= 50);
  assert.ok(sections.every((section) => section.text.text.length <= SAFE_SECTION_TEXT_LENGTH));
  assert.ok(sections.every((section) => section.text.text.length <= 3000));
  const allText = sections.map((section) => section.text.text).join('\n');
  assert.match(allText, /Individual Balances/);
  for (const record of records) {
    const expected = `• *${record.name}*: ${record.annualRemaining} days remaining | Sick: ${record.sickUsed} days | Hajj: ${record.hajjUsed > 0 ? '✅' : '—'} | Maternity: ${Number(record.maternityUsed || 0)} calendar days`;
    assert.equal(allText.split(expected).length - 1, 1, 'each complete employee row must appear exactly once');
  }
  const fields = blockFields(message);
  assert.equal(fields.find((field) => field.text.includes('Total Employees')).text, '*Total Employees:*\n40');
  assert.equal(fields.find((field) => field.text.includes('Fully Used Leave')).text, '*Fully Used Leave:*\n2 employee(s)');
  assert.equal(fields.find((field) => field.text.includes('Low Balance')).text, '*Low Balance (≤5 days):*\n10 employee(s)');
  assert.equal(fields.find((field) => field.text.includes('No Leave Taken Yet')).text, '*No Leave Taken Yet:*\n1 employee(s)');
  assert.deepEqual(records, before);
});
