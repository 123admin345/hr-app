const { getAllEmployees, getEmployeeBySlackId } = require('../utils/sheets');

/**
 * Registers admin-only commands on the Bolt app.
 * All responses are sent as DMs to avoid "not_in_channel" errors.
 */
function registerAdminHandlers(app) {
  const ADMIN_IDS = (process.env.ADMIN_SLACK_IDS || '').split(',').map((id) => id.trim());

  function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
  }

  // Helper: open a DM channel and send a message
  async function sendDM(client, userId, payload) {
    const dm = await client.conversations.open({ users: userId });
    const channelId = dm.channel.id;
    await client.chat.postMessage({ channel: channelId, ...payload });
  }

  // ─── /hr-balance command ───────────────────────────────────────────────────
  // Usage: /hr-balance  (shows all employees — admin only)
  app.command('/hr-balance', async ({ command, ack, client, logger }) => {
    await ack();

    if (!isAdmin(command.user_id)) {
      await sendDM(client, command.user_id, {
        text: '⛔ This command is only available to HR admins.',
      });
      return;
    }

    try {
      const employees = await getAllEmployees();
      if (employees.length === 0) {
        await sendDM(client, command.user_id, {
          text: 'No employees found in the HR system.',
        });
        return;
      }

      const rows = employees.map((e) =>
        `• *${e.name}* (<@${e.slackUserId}>): Annual ${e.annualRemaining}/${e.annualTotal} days remaining | Sick: ${e.sickUsed} days | Hajj: ${e.hajjUsed > 0 ? 'Used ✅' : 'Not used'}`
      );

      await sendDM(client, command.user_id, {
        text: `*📊 HR Leave Balance Summary*\n\n${rows.join('\n')}`,
      });
    } catch (err) {
      logger.error('Error fetching balances:', err);
      await sendDM(client, command.user_id, {
        text: '❌ Something went wrong fetching balances. Please try again or contact the system admin.',
      });
    }
  });

  // ─── /my-balance command ───────────────────────────────────────────────────
  // Any employee can check their own balance — response always sent as a DM
  app.command('/my-balance', async ({ command, ack, client, logger }) => {
    await ack();

    try {
      const employee = await getEmployeeBySlackId(command.user_id);

      if (!employee) {
        await sendDM(client, command.user_id, {
          text: '⚠️ You are not registered in the HR system. Please contact HR.',
        });
        return;
      }

      await sendDM(client, command.user_id, {
        text: `📊 *Your Leave Balance, ${employee.name}*`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '📊 Your Leave Balance',
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Hello *${employee.name}* — here is your current leave summary:`,
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*🏖️ Annual Leave*\n${employee.annualRemaining} days remaining\n_(of ${employee.annualTotal} total)_`,
              },
              {
                type: 'mrkdwn',
                text: `*🤒 Sick Leave Used*\n${employee.sickUsed} day(s) this year`,
              },
              {
                type: 'mrkdwn',
                text: `*🕌 Hajj Leave*\n${employee.hajjUsed > 0 ? 'Used ✅' : 'Not yet used'}`,
              },
              {
                type: 'mrkdwn',
                text: `*🔄 Year-End Rollover*\n${employee.rolloverAllowed ? 'Allowed ✅' : 'Not allowed — use before year end'}`,
              },
            ],
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '_This message is only visible to you. For questions, contact HR._',
              },
            ],
          },
        ],
      });
    } catch (err) {
      logger.error('Error fetching balance:', err);
      try {
        await sendDM(client, command.user_id, {
          text: '❌ Something went wrong fetching your balance. Please try again or contact HR.',
        });
      } catch (dmErr) {
        logger.error('Could not send DM error message:', dmErr);
      }
    }
  });
}

module.exports = { registerAdminHandlers };
