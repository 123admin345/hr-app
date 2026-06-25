const { getAllEmployees, getEmployeeBySlackId } = require('../utils/sheets');

/**
 * Registers admin-only commands on the Bolt app.
 * These commands are only usable by users whose Slack ID is in ADMIN_SLACK_IDS env var.
 */
function registerAdminHandlers(app) {
  const ADMIN_IDS = (process.env.ADMIN_SLACK_IDS || '').split(',').map((id) => id.trim());

  function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
  }

  // ─── /hr-balance command ───────────────────────────────────────────────────
  // Usage: /hr-balance @username  OR  /hr-balance (shows all)
  app.command('/hr-balance', async ({ command, ack, client, logger }) => {
    await ack();
    if (!isAdmin(command.user_id)) {
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: '⛔ This command is only available to HR admins.',
      });
      return;
    }

    try {
      const employees = await getAllEmployees();
      if (employees.length === 0) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: 'No employees found in the HR system.',
        });
        return;
      }

      const rows = employees.map((e) =>
        `• *${e.name}* (<@${e.slackUserId}>): Annual ${e.annualRemaining}/${e.annualTotal} days remaining | Sick: ${e.sickUsed} days | Hajj: ${e.hajjUsed > 0 ? 'Used ✅' : 'Not used'}`
      );

      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `*📊 HR Leave Balance Summary*\n\n${rows.join('\n')}`,
      });
    } catch (err) {
      logger.error('Error fetching balances:', err);
    }
  });

  // ─── /my-balance command ───────────────────────────────────────────────────
  // Any employee can check their own balance
  app.command('/my-balance', async ({ command, ack, client, logger }) => {
    await ack();
    try {
      const employee = await getEmployeeBySlackId(command.user_id);
      if (!employee) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: '⚠️ You are not registered in the HR system. Please contact HR.',
        });
        return;
      }

      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `📊 *Your Leave Balance*`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `📊 *Your Leave Balance, ${employee.name}*`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*🏖️ Annual Leave:*\n${employee.annualRemaining} days remaining (of ${employee.annualTotal})` },
              { type: 'mrkdwn', text: `*🤒 Sick Leave Used:*\n${employee.sickUsed} day(s) this year` },
              { type: 'mrkdwn', text: `*🕌 Hajj Leave:*\n${employee.hajjUsed > 0 ? 'Used ✅' : 'Not yet used'}` },
              { type: 'mrkdwn', text: `*🔄 Rollover:*\n${employee.rolloverAllowed ? 'Allowed ✅' : 'Not allowed — use before year end'}` },
            ],
          },
        ],
      });
    } catch (err) {
      logger.error('Error fetching balance:', err);
    }
  });
}

module.exports = { registerAdminHandlers };
