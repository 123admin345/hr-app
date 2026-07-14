const cron = require('node-cron');
const { getApprovedLeavesStartingToday, getEmployeesWithRemainingBalance, getUpcomingHolidays } = require('../utils/sheets');
const { formatDate } = require('../utils/dates');

// OOO alerts go to both #general and #social
const GENERAL_CHANNEL = process.env.GENERAL_CHANNEL_ID || '';
const SOCIAL_CHANNEL = process.env.SOCIAL_CHANNEL_ID || '';
// Holiday announcements go to #general only
const ANNOUNCEMENTS_CHANNEL = process.env.GENERAL_CHANNEL_ID || '';
const HR_ADMIN_ID = (process.env.ADMIN_SLACK_IDS || '').split(',')[0].trim();

/**
 * Registers all cron-based scheduled jobs.
 * @param {import('@slack/bolt').App} app - The Bolt app instance
 */
function registerScheduledJobs(app) {

  // ─── Daily OOO Alerts (runs every day at 8:00 AM) ────────────────────────
  // Posts to BOTH #general and #social when an employee's approved leave starts today
  cron.schedule('0 8 * * *', async () => {
    try {
      const leavesToday = await getApprovedLeavesStartingToday();
      for (const leave of leavesToday) {
        const [, employeeName, slackUserId, leaveType, startDate, endDate, totalDays] = leave;
        const leaveEmoji = leaveType === 'Annual' ? '🏖️' : leaveType === 'Sick' ? '🤒' : '🕌';
        const oooMessage = {
          text: `${leaveEmoji} ${employeeName} is on ${leaveType} Leave today`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${leaveEmoji} *<@${slackUserId}> is on ${leaveType} Leave*\n\n*Period:* ${formatDate(startDate)} → ${formatDate(endDate)} (${totalDays} working day(s))\n\nPlease plan accordingly and avoid reaching out to them during this period. 🙏`,
              },
            },
          ],
        };
        // Post to #general
        if (GENERAL_CHANNEL) {
          await app.client.chat.postMessage({ channel: GENERAL_CHANNEL, ...oooMessage });
        }
        // Post to #social
        if (SOCIAL_CHANNEL) {
          await app.client.chat.postMessage({ channel: SOCIAL_CHANNEL, ...oooMessage });
        }
      }
    } catch (err) {
      console.error('OOO job error:', err);
    }
  }, { timezone: 'Asia/Riyadh' });

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

  // ─── End-of-Year Reminders (runs on Nov 1 and Dec 1 at 9:00 AM) ──────────
  // Sends a DM to every employee with unused annual leave (excluding rollover employees)
  cron.schedule('0 9 1 11,12 *', async () => {
    try {
      const employees = await getEmployeesWithRemainingBalance();
      for (const emp of employees) {
        const isDecember = new Date().getMonth() === 11; // 0-indexed
        if (emp.rolloverAllowed) {
          // Special message for the 4 rollover-allowed employees
          await app.client.chat.postMessage({
            channel: emp.slackUserId,
            text: `📅 Year-End Leave Balance Reminder`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `📅 *Year-End Leave Balance Reminder*\n\nHi ${emp.name}, you currently have *${emp.annualRemaining} days* of annual leave remaining.\n\nAs one of our team members with a *rollover allowance*, your unused balance will carry forward to next year. However, we encourage you to plan your time off to ensure you get the rest you deserve! 😊`,
                },
              },
            ],
          });
        } else {
          // Standard message for all other employees
          await app.client.chat.postMessage({
            channel: emp.slackUserId,
            text: `⚠️ You have ${emp.annualRemaining} unused leave days — please submit before year end!`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `⚠️ *Year-End Leave Reminder*\n\nHi ${emp.name}, you currently have *${emp.annualRemaining} days* of annual leave remaining.\n\nOur policy does not allow unused days to roll over to the next year. ${isDecember ? '⏰ *December is here — this is your last chance!*' : 'Please make sure to submit your leave requests before *December 31st*.'}\n\nType `/request-leave` in any Slack channel to submit your request. 🗓️`,
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '🗓️ Request Leave Now', emoji: true },
                    action_id: 'open_leave_from_reminder',
                    style: 'primary',
                  },
                ],
              },
            ],
          });
        }
      }
    } catch (err) {
      console.error('End-of-year reminder job error:', err);
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
