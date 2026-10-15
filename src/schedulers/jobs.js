const cron = require('node-cron');
const { getUpcomingHolidays } = require('../utils/sheets');
const { formatDate } = require('../utils/dates');
const {
  startPerformanceReviewCase,
  openContractReviewsDue,
  processPerformanceReviewDeadlines,
  sendMonthlyPerformanceReport,
} = require('../handlers/performanceReviewHandler');

// Public holiday announcements go to #general only.
const ANNOUNCEMENTS_CHANNEL = process.env.GENERAL_CHANNEL_ID || '';
const HR_ADMIN_ID = (process.env.ADMIN_SLACK_IDS || '').split(',')[0].trim();

/**
 * Registers all cron-based scheduled jobs.
 * @param {import('@slack/bolt').App} app - The Bolt app instance
 */
function registerScheduledJobs(app) {

  // ─── Weekly Public Holiday Announcements (runs every Sunday at 9:00 AM) ──
  // Checks the Public Holidays sheet for any holiday in the next 7 days
  cron.schedule('0 9 * * 0', async () => {
    try {
      const holidays = await getUpcomingHolidays(7);
      for (const holiday of holidays) {
        await app.client.chat.postMessage({
          channel: ANNOUNCEMENTS_CHANNEL,
          text: `🎉 Upcoming Public Holiday: ${holiday.name}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `🎉 *Upcoming Public Holiday Reminder*\n\n*${holiday.name}* is on *${formatDate(holiday.date)}*.\n\nThe office will be closed on this day. Enjoy the holiday! 🌟`,
              },
            },
          ],
        });
      }
    } catch (err) {
      console.error('Holiday announcement job error:', err);
    }
  }, { timezone: 'Asia/Riyadh' });


  // ─── Monthly Leave Report (runs on the 1st of each month at 8:00 AM) ─────
  // Sends a summary report to the HR admin
  cron.schedule('0 8 1 * *', async () => {
    try {
      const { getAllEmployees } = require('../utils/sheets');
      const employees = await getAllEmployees();
      const totalEmployees = employees.length;
      const fullyUsed = employees.filter((e) => e.annualRemaining === 0).length;
      const lowBalance = employees.filter((e) => e.annualRemaining > 0 && e.annualRemaining <= 5).length;
      const noLeaveYet = employees.filter((e) => e.annualUsed === 0).length;

      const rows = employees
        .sort((a, b) => a.annualRemaining - b.annualRemaining)
        .map((e) => `• *${e.name}*: ${e.annualRemaining} days remaining | Sick: ${e.sickUsed} days | Hajj: ${e.hajjUsed > 0 ? '✅' : '—'}`)
        .join('\n');

      const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

      await app.client.chat.postMessage({
        channel: HR_ADMIN_ID,
        text: `📊 Monthly HR Leave Report — ${month}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `📊 Monthly HR Leave Report — ${month}`, emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Total Employees:*\n${totalEmployees}` },
              { type: 'mrkdwn', text: `*Fully Used Leave:*\n${fullyUsed} employee(s)` },
              { type: 'mrkdwn', text: `*Low Balance (≤5 days):*\n${lowBalance} employee(s)` },
              { type: 'mrkdwn', text: `*No Leave Taken Yet:*\n${noLeaveYet} employee(s)` },
            ],
          },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Individual Balances:*\n\n${rows}` },
          },
        ],
      });
    } catch (err) {
      console.error('Monthly report job error:', err);
    }
  }, { timezone: 'Asia/Riyadh' });

  // ─── Contract Renewal Reviews (daily at 9:15 AM) ──────────────────────────
  // Starts a documented review exactly 75 calendar days (about 2.5 months)
  // before each employee's contract end date.
  cron.schedule('15 9 * * *', async () => {
    try {
      await openContractReviewsDue(app.client);
    } catch (err) {
      console.error('Contract renewal review job error:', err);
    }
  }, { timezone: 'Asia/Riyadh' });

  // ─── Semi-Annual Performance Reviews (June 1 and December 1, 9:30 AM) ───
  cron.schedule('30 9 1 6,12 *', async () => {
    try {
      const { getAllEmployees, getActivePerformanceReviewForEmployee } = require('../utils/sheets');
      const employees = await getAllEmployees();
      for (const employee of employees) {
        if (!employee.slackUserId || !employee.managerSlackId) continue;
        const active = await getActivePerformanceReviewForEmployee(employee.slackUserId, 'Semi-Annual');
        if (!active) await startPerformanceReviewCase(app.client, employee, 'Semi-Annual');
      }
    } catch (err) {
      console.error('Semi-annual performance review job error:', err);
    }
  }, { timezone: 'Asia/Riyadh' });

  // ─── Performance Review Deadlines (weekdays at 9:45 AM) ──────────────────
  // Handles overdue initial submissions, meeting reminders, status checks,
  // edit-window lock, and automatic HR/CEO escalation for unequal ratings.
  cron.schedule('45 9 * * 0-4', async () => {
    try {
      await processPerformanceReviewDeadlines(app.client);
    } catch (err) {
      console.error('Performance review deadline job error:', err);
    }
  }, { timezone: 'Asia/Riyadh' });

  // ─── Monthly Performance Review Report (1st of month, 8:15 AM) ──────────
  cron.schedule('15 8 1 * *', async () => {
    try {
      await sendMonthlyPerformanceReport(app.client);
    } catch (err) {
      console.error('Monthly performance review report error:', err);
    }
  }, { timezone: 'Asia/Riyadh' });

  console.log('✅ All scheduled jobs registered (timezone: Asia/Riyadh)');
}

// ─── Action: Open leave modal from reminder button ─────────────────────────
function registerReminderActions(app) {
  app.action('open_leave_from_reminder', async ({ ack, body, client, logger }) => {
    await ack();
    const { buildLeaveRequestModal } = require('../modals/leaveRequestModal');
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildLeaveRequestModal(),
      });
    } catch (err) {
      logger.error('Error opening leave modal from reminder:', err);
    }
  });
}

module.exports = { registerScheduledJobs, registerReminderActions };
