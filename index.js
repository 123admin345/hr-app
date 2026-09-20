require('dotenv').config();
const { App } = require('@slack/bolt');
const express = require('express');

const { registerLeaveHandlers } = require('./src/handlers/leaveHandler');
const { registerAdminHandlers } = require('./src/handlers/adminHandler');
const { registerSalaryRaiseHandlers } = require('./src/handlers/salaryRaiseHandler');
const { registerPerformanceReviewHandlers } = require('./src/handlers/performanceReviewHandler');
const { registerScheduledJobs, registerReminderActions } = require('./src/schedulers/jobs');

// ─── Initialize Bolt App ───────────────────────────────────────────────────
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: false,
  port: process.env.PORT || 3000,
  processBeforeResponse: true,  // Ensures ack() is called before heavy async work
});

// ─── Register all handlers ─────────────────────────────────────────────────
registerLeaveHandlers(app);
registerAdminHandlers(app);
registerSalaryRaiseHandlers(app);
registerPerformanceReviewHandlers(app);
registerReminderActions(app);

// ─── Register scheduled jobs ───────────────────────────────────────────────
registerScheduledJobs(app);

// ─── Health check endpoint (for hosting platforms) ────────────────────────
// This keeps the free hosting service alive and allows monitoring
const expressApp = express();
expressApp.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
expressApp.listen(process.env.HEALTH_PORT || 3001, () => {
  console.log('Health check server running on port', process.env.HEALTH_PORT || 3001);
});

// ─── Start the Bolt app ────────────────────────────────────────────────────
(async () => {
  await app.start();
  console.log('⚡️ Slack HR App is running!');
  console.log('📋 Registered commands: /request-leave, /my-balance, /hr-balance, /request-raise, /start-performance-review');
  console.log('🕐 Scheduled jobs: leave and holiday notifications, monthly reports, contract renewal reviews, and semi-annual performance reviews');
})();
