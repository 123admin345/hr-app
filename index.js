require('dotenv').config();
const { App, ExpressReceiver } = require('@slack/bolt');

const { registerLeaveHandlers } = require('./src/handlers/leaveHandler');
const { registerAdminHandlers } = require('./src/handlers/adminHandler');
const { registerSalaryRaiseHandlers } = require('./src/handlers/salaryRaiseHandler');
const { registerPerformanceReviewHandlers, processPerformanceReviewDeadlines } = require('./src/handlers/performanceReviewHandler');
const { registerVisaRequestHandlers } = require('./src/handlers/visaRequestHandler');
const { registerNewHireHandlers } = require('./src/handlers/newHireHandler');
const { registerScheduledJobs, registerReminderActions } = require('./src/schedulers/jobs');

// ─── Initialize Bolt App and public health endpoint ─────────────────────────
// The health route must use the same Render port as Slack. The previous
// separate port could not be reached through the live Render URL.
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse: true,
});
receiver.router.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'slack-hr-app', timestamp: new Date().toISOString() });
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
  socketMode: false,
  processBeforeResponse: true,  // Ensures ack() is called before heavy async work
});

// ─── Register all handlers ─────────────────────────────────────────────────
registerLeaveHandlers(app);
registerAdminHandlers(app);
registerSalaryRaiseHandlers(app);
registerPerformanceReviewHandlers(app);
registerVisaRequestHandlers(app);
registerNewHireHandlers(app);
registerReminderActions(app);

// ─── Register scheduled jobs ───────────────────────────────────────────────
registerScheduledJobs(app);

// ─── Start the Bolt app ────────────────────────────────────────────────────
(async () => {
  await app.start(process.env.PORT || 3000);
  // Render's free service can sleep through node-cron times. On every service
  // start, catch up any overdue performance-review discussion or deadline
  // transitions before logging that the app is ready.
  await processPerformanceReviewDeadlines(app.client);
  console.log('⚡️ Slack HR App is running!');
  console.log('💚 Health endpoint: /health');
  console.log('📋 Registered commands: /request-leave, /cancel-leave, /my-balance, /hr-balance, /request-raise, /start-performance-review, /request-exit-reentry-visa, /request-new-hire');
  console.log('🕐 Scheduled jobs: leave and holiday notifications, monthly reports, contract renewal reviews, and semi-annual performance reviews');
})();
