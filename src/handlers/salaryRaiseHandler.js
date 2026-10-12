/**
 * Salary Raise Request Handler
 *
 * Workflow:
 *  1. Manager runs /request-raise → form opens
 *  2. Manager fills form → clicks "Review Request →"
 *  3. App calculates difference + effective month → confirmation modal
 *  4. Manager clicks "Send to Dr. Mohammed" → owner receives approval request
 *  5a. Owner approves → manager notified + HR channel + HR manager DM + Finance manager DM
 *  5b. Owner rejects → rejection reason modal → reason sent to manager
 *
 * Effective month logic:
 *  - If today is day 1–10 of the month → raise reflects THIS month
 *  - If today is day 11+ → raise reflects NEXT month
 */

const { buildSalaryRaiseFormModal, buildSalaryRaiseConfirmModal, buildRaiseRejectModal } = require('../modals/salaryRaiseModal');
const { addSalaryRaiseRequest, updateSalaryRaiseStatus, getEmployeeBySlackId } = require('../utils/sheets');

// ── Hardcoded IDs (set in env for flexibility) ─────────────────────────────
const OWNER_SLACK_ID    = process.env.OWNER_SLACK_ID    || 'U0ATTSVK1L6';
const HR_MANAGER_ID     = process.env.HR_MANAGER_ID     || 'U0ASG55FV0W';
const FINANCE_MANAGER_ID = process.env.FINANCE_MANAGER_ID || 'U0ASEQCTS3F';
const HR_CHANNEL_ID     = process.env.HR_CHANNEL_ID     || '';  // set in env as channel ID

/**
 * Calculates the effective month for the raise.
 * Days 1–10: same month. Days 11+: next month.
 */
function getEffectiveMonth() {
  const today = new Date();
  const day   = today.getDate();
  let effectiveDate;
  if (day <= 10) {
    effectiveDate = new Date(today.getFullYear(), today.getMonth(), 1);
  } else {
    effectiveDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  }
  return effectiveDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Formats a number as SAR currency string.
 */
function formatSAR(amount) {
  return `SAR ${Number(amount).toLocaleString('en-SA')}`;
}

/**
 * Registers all salary raise handlers on the Bolt app.
 */
function registerSalaryRaiseHandlers(app) {

  // ─── /request-raise command ────────────────────────────────────────────────
  app.command('/request-raise', async ({ command, ack, client, logger }) => {
    await ack();
    try {
      // ── Manager-only check ──────────────────────────────────────────────────
      const employee = await getEmployeeBySlackId(command.user_id);
      if (!employee || !employee.isManager) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: '⚠️ This command is only available to managers. If you believe this is an error, please contact HR.',
        });
        return;
      }
      await client.views.open({
        trigger_id: command.trigger_id,
        view: buildSalaryRaiseFormModal(),
      });
    } catch (err) {
      logger.error('Error opening salary raise modal:', err);
    }
  });

  // ─── Step 1: Review handler — validates, calculates, shows confirmation ────
  app.view('salary_raise_review', async ({ ack, view, body, client, logger }) => {
    const values        = view.state.values;
    const managerId     = body.user.id;
    const employeeName  = values.employee_name_block.employee_name_input.value?.trim();
    const employeeSlackId = values.employee_user_block.employee_user_select?.selected_user || null;
    const currentSalaryRaw = values.current_salary_block.current_salary_input.value?.trim().replace(/,/g, '');
    const newSalaryRaw     = values.new_salary_block.new_salary_input.value?.trim().replace(/,/g, '');
    const reason        = values.raise_reason_block.raise_reason_input.value?.trim();

    // ── Validation ────────────────────────────────────────────────────────────
    const errors = {};
    if (!employeeName) errors.employee_name_block = 'Please enter the employee\'s full name.';
    if (!currentSalaryRaw || isNaN(Number(currentSalaryRaw)) || Number(currentSalaryRaw) <= 0) {
      errors.current_salary_block = 'Please enter a valid current salary (numbers only).';
    }
    if (!newSalaryRaw || isNaN(Number(newSalaryRaw)) || Number(newSalaryRaw) <= 0) {
      errors.new_salary_block = 'Please enter a valid new salary (numbers only).';
    }
    if (!errors.current_salary_block && !errors.new_salary_block) {
      if (Number(newSalaryRaw) <= Number(currentSalaryRaw)) {
        errors.new_salary_block = 'New salary must be higher than the current salary.';
      }
    }
    if (!reason) errors.raise_reason_block = 'Please provide a reason for this raise request.';

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors });
      return;
    }

    try {
      const currentSalary     = Number(currentSalaryRaw);
      const newSalary         = Number(newSalaryRaw);
      const difference        = newSalary - currentSalary;
      const percentageIncrease = ((difference / currentSalary) * 100).toFixed(1);
      const effectiveMonth    = getEffectiveMonth();

      await ack({
        response_action: 'push',
        view: buildSalaryRaiseConfirmModal({
          employeeName,
          employeeSlackId,
          currentSalary,
          newSalary,
          reason,
          difference,
          percentageIncrease,
          effectiveMonth,
        }),
      });
    } catch (err) {
      logger.error('Error in salary raise review step:', err);
      await ack({ response_action: 'errors', errors: { employee_name_block: 'Something went wrong. Please try again.' } });
    }
  });

  // ─── Step 2: Final submission — sends request to owner ────────────────────
  app.view('salary_raise_submit', async ({ ack, view, body, client, logger }) => {
    await ack();
    const managerId = body.user.id;
    const { employeeName, employeeSlackId, currentSalary, newSalary, difference, percentageIncrease, reason, effectiveMonth } = JSON.parse(view.private_metadata || '{}');

    try {
      const requestId = `RAISE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // Log to Google Sheets
      await addSalaryRaiseRequest({
        requestId,
        managerId,
        employeeName,
        employeeSlackId: employeeSlackId || '',
        currentSalary,
        newSalary,
        difference,
        percentageIncrease,
        reason,
        effectiveMonth,
      });

      const formattedCurrent = formatSAR(currentSalary);
      const formattedNew     = formatSAR(newSalary);
      const formattedDiff    = formatSAR(difference);

      // ── Notify the owner ─────────────────────────────────────────────────────
      await client.chat.postMessage({
        channel: OWNER_SLACK_ID,
        text: `💰 New Salary Raise Request — ${employeeName}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '💰 Salary Raise Request', emoji: true },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Requested by:* <@${managerId}>\n*Employee:* ${employeeName}${employeeSlackId ? ` (<@${employeeSlackId}>)` : ''}`,
            },
          },
          { type: 'divider' },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Current Salary:*\n${formattedCurrent}` },
              { type: 'mrkdwn', text: `*New Salary:*\n${formattedNew}` },
              { type: 'mrkdwn', text: `*Increase Amount:*\n*${formattedDiff}*` },
              { type: 'mrkdwn', text: `*Increase Percentage:*\n*${percentageIncrease}%*` },
              { type: 'mrkdwn', text: `*Effective Month:*\n📅 ${effectiveMonth}` },
            ],
          },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Reason:*\n${reason}` },
          },
          { type: 'divider' },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '✅ Approve', emoji: true },
                style: 'primary',
                action_id: 'approve_salary_raise',
                value: JSON.stringify({ requestId, managerId, employeeName, employeeSlackId, currentSalary, newSalary, difference, percentageIncrease, reason, effectiveMonth }),
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '❌ Reject', emoji: true },
                style: 'danger',
                action_id: 'reject_salary_raise',
                value: JSON.stringify({ requestId, managerId, employeeName, employeeSlackId, currentSalary, newSalary, difference, percentageIncrease, reason, effectiveMonth }),
              },
            ],
          },
        ],
      });

      // ── Confirm to manager ───────────────────────────────────────────────────
      await client.chat.postMessage({
        channel: managerId,
        text: `✅ Your salary raise request for *${employeeName}* has been sent to Dr. Mohammed for approval.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Raise request submitted successfully!*\n\nYour request to raise *${employeeName}'s* salary from *${formattedCurrent}* to *${formattedNew}* (+${formattedDiff}, ${percentageIncrease}%) has been sent to *Dr. Mohammed* for approval.\n\nYou will receive a message here once a decision is made.`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error submitting salary raise request:', err);
      await client.chat.postMessage({
        channel: managerId,
        text: '❌ Something went wrong while submitting the raise request. Please try again or contact HR.',
      });
    }
  });

  // ─── Approve button (owner clicks) ────────────────────────────────────────
  app.action('approve_salary_raise', async ({ ack, body, action, client, logger }) => {
    await ack();
    const ownerId = body.user.id;
    const data    = JSON.parse(action.value);
    const { requestId, managerId, employeeName, employeeSlackId, currentSalary, newSalary, difference, percentageIncrease, reason, effectiveMonth } = data;

    try {
      await updateSalaryRaiseStatus(requestId, 'Approved', '');

      const formattedCurrent = formatSAR(currentSalary);
      const formattedNew     = formatSAR(newSalary);
      const formattedDiff    = formatSAR(difference);

      const approvalSummary = `*Employee:* ${employeeName}${employeeSlackId ? ` (<@${employeeSlackId}>)` : ''}\n*Previous Salary:* ${formattedCurrent}\n*New Salary:* ${formattedNew}\n*Increase:* ${formattedDiff} (${percentageIncrease}%)\n*Effective Month:* 📅 ${effectiveMonth}\n*Approved by:* Dr. Mohammed Zamakhshary`;

      // ── Notify the requesting manager ────────────────────────────────────────
      await client.chat.postMessage({
        channel: managerId,
        text: `🎉 Salary raise approved for ${employeeName}!`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🎉 *Salary raise approved by Dr. Mohammed!*\n\n${approvalSummary}\n\nThis raise will be reflected in the *${effectiveMonth}* payroll.`,
            },
          },
        ],
      });

      // ── Notify HR channel ────────────────────────────────────────────────────
      if (HR_CHANNEL_ID) {
        await client.chat.postMessage({
          channel: HR_CHANNEL_ID,
          text: `✅ Approved Salary Raise — ${employeeName}`,
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: '✅ Approved Salary Raise', emoji: true },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${approvalSummary}\n\n_Please update the employee's salary record accordingly._`,
              },
            },
          ],
        });
      }

      // ── DM HR Manager ────────────────────────────────────────────────────────
      await client.chat.postMessage({
        channel: HR_MANAGER_ID,
        text: `✅ Approved Salary Raise — Action Required`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Approved Salary Raise — Action Required*\n\n${approvalSummary}\n\n📋 Please update ${employeeName}'s salary record to reflect *${formattedNew}* starting *${effectiveMonth}*.`,
            },
          },
        ],
      });

      // ── DM Finance Manager ───────────────────────────────────────────────────
      await client.chat.postMessage({
        channel: FINANCE_MANAGER_ID,
        text: `✅ Approved Salary Raise — Payroll Update Required`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Approved Salary Raise — Payroll Update Required*\n\n${approvalSummary}\n\n💰 Please ensure the new salary of *${formattedNew}* is reflected in the *${effectiveMonth}* payroll run.`,
            },
          },
        ],
      });

      // ── Update the owner's message to remove buttons ─────────────────────────
      await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `✅ Approved — ${employeeName} salary raise`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Approved by Dr. Mohammed Zamakhshary*\n\n${approvalSummary}`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error approving salary raise:', err);
    }
  });

  // ─── Reject button (owner clicks) — opens reason modal ───────────────────
  app.action('reject_salary_raise', async ({ ack, body, action, client, logger }) => {
    await ack();
    const data = JSON.parse(action.value);
    try {
      await client.views.open({
        trigger_id: body.trigger_id,
        view: buildRaiseRejectModal(action.value, data.employeeName),
      });
    } catch (err) {
      logger.error('Error opening raise rejection modal:', err);
    }
  });

  // ─── Rejection reason submission ──────────────────────────────────────────
  app.view('salary_raise_reject_submit', async ({ ack, view, body, client, logger }) => {
    await ack();
    const ownerId      = body.user.id;
    const rejectReason = view.state.values.reject_reason_block.reject_reason_input.value;
    const data         = JSON.parse(view.private_metadata || '{}');
    const { requestId, managerId, employeeName, employeeSlackId, currentSalary, newSalary, difference, percentageIncrease, effectiveMonth } = data;

    try {
      await updateSalaryRaiseStatus(requestId, 'Rejected', rejectReason);

      const formattedCurrent = formatSAR(currentSalary);
      const formattedNew     = formatSAR(newSalary);
      const formattedDiff    = formatSAR(difference);

      // ── Notify the requesting manager ────────────────────────────────────────
      await client.chat.postMessage({
        channel: managerId,
        text: `❌ Salary raise request for ${employeeName} was not approved.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ *Salary raise request not approved — ${employeeName}*\n\n*Requested raise:* ${formattedCurrent} → ${formattedNew} (+${formattedDiff}, ${percentageIncrease}%)\n\n*Feedback from Dr. Mohammed:*\n_${rejectReason}_`,
            },
          },
        ],
      });

    } catch (err) {
      logger.error('Error processing raise rejection:', err);
    }
  });
}

module.exports = { registerSalaryRaiseHandlers };
