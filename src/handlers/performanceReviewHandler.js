const {
  buildStartReviewModal,
  buildAssessmentModal,
  buildMeetingDateModal,
  buildMeetingSlotsModal,
  buildFinalDecisionModal,
  buildHrResolutionModal,
} = require('../modals/performanceReviewModal');
const {
  getEmployeeBySlackId,
  getAllEmployees,
  getAllPerformanceReviews,
  getPerformanceReviewCase,
  addPerformanceReviewCase,
  updatePerformanceReviewCase,
  appendPerformanceReviewAudit,
  getActivePerformanceReviewForEmployee,
} = require('../utils/sheets');
const {
  PERFORMANCE_CATEGORIES,
  calculateOverallRating,
  safeJson,
  formatAssessment,
  scoreLabel,
} = require('../utils/performance');
const { addCalendarDays, addBusinessDays, daysUntil, formatDate, todayDateString } = require('../utils/dates');

const OWNER_SLACK_ID = process.env.OWNER_SLACK_ID || 'U0ATTSVK1L6';
const HR_MANAGER_ID = process.env.HR_MANAGER_ID || 'U0ASG55FV0W';
const ADMIN_SLACK_IDS = (process.env.ADMIN_SLACK_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
const HR_ROOM_BOOKING_URL = (process.env.HR_ROOM_BOOKING_URL || '').replace(/\/$/, '');
const HR_ROOM_BOOKING_SECRET = process.env.HR_ROOM_BOOKING_SECRET || '';
const INITIAL_REVIEW_DAYS = 10;
const DISCUSSION_WINDOW_DAYS = 10;

function isHrOrAdmin(userId) {
  return userId === HR_MANAGER_ID || userId === OWNER_SLACK_ID || ADMIN_SLACK_IDS.includes(userId);
}

function generateCaseId() {
  return `PERF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function readAssessment(view) {
  const scores = {};
  const errors = {};
  PERFORMANCE_CATEGORIES.forEach(({ key }) => {
    const selected = view.state.values[`score_${key}`]?.[`score_${key}_select`]?.selected_option?.value;
    if (!selected) errors[`score_${key}`] = 'Please select a rating.';
    else scores[key] = Number(selected);
  });
  const comments = view.state.values.comments?.comments_input?.value?.trim() || '';
  return { scores, comments, errors };
}

function reviewActionValue(caseId) {
  return JSON.stringify({ caseId });
}

async function sendPrivate(client, userId, message) {
  await client.chat.postMessage({ channel: userId, ...message });
}

async function notifyReviewOpened(client, review) {
  const isContractRenewal = Boolean(review.contractEndDate);
  const leavePlanningEmployeeText = isContractRenewal
    ? `\n\n🏖️ *Annual Leave Planning Before Contract End*\n\nYour contract ends on *${formatDate(review.contractEndDate)}*. You currently have *${review.annualBalance} unused annual-leave day(s)*. Please plan and submit any required leave before your contract end date. Type \`/request-leave\` in Slack to submit a request.`
    : '';
  const leavePlanningManagerText = isContractRenewal
    ? `\n\n🏖️ *Annual Leave Planning*\n\n${review.employeeName} has *${review.annualBalance} unused annual-leave day(s)* to plan before the contract end date of *${formatDate(review.contractEndDate)}*. Please coordinate operational coverage and leave planning with the employee.`
    : '';
  const leavePlanningHrText = isContractRenewal
    ? `\n*Annual Leave Planning:* ${review.annualBalance} unused day(s) must be planned before *${formatDate(review.contractEndDate)}*.`
    : '';
  const employeeMessage = {
    text: `📋 Performance review opened for ${review.reviewType}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📋 *${review.reviewType} Opened*\n\nYour performance review is now open. Please complete your independent self-assessment by *${formatDate(review.initialDueDate)}*. Your manager will complete a separate assessment. Neither person sees the other assessment until both are submitted.${leavePlanningEmployeeText}`,
        },
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Complete Self-Assessment', emoji: true }, style: 'primary', action_id: 'open_self_assessment', value: reviewActionValue(review.caseId) },
          ...(isContractRenewal ? [{ type: 'button', text: { type: 'plain_text', text: 'Request Annual Leave', emoji: true }, action_id: 'open_leave_from_reminder' }] : []),
        ],
      },
    ],
  };
  const managerMessage = {
    text: `📋 Performance review opened for ${review.employeeName}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📋 *${review.reviewType} Opened — ${review.employeeName}*\n\nPlease complete your independent manager assessment by *${formatDate(review.initialDueDate)}*. The employee has been asked to submit a self-assessment independently.${leavePlanningManagerText}`,
        },
      },
      {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Complete Manager Assessment', emoji: true }, style: 'primary', action_id: 'open_manager_assessment', value: reviewActionValue(review.caseId) }],
      },
    ],
  };

  await Promise.all([
    sendPrivate(client, review.employeeSlackId, employeeMessage),
    sendPrivate(client, review.managerSlackId, managerMessage),
    sendPrivate(client, HR_MANAGER_ID, {
      text: `📋 Performance review opened — ${review.employeeName}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `📋 *${review.reviewType} Opened*\n\n*Employee:* <@${review.employeeSlackId}>\n*Manager:* <@${review.managerSlackId}>\n*Initial Submission Deadline:* ${formatDate(review.initialDueDate)}${isContractRenewal ? `\n*Contract End Date:* ${formatDate(review.contractEndDate)}${leavePlanningHrText}` : ''}` } }],
    }),
  ]);
}

async function openAssessment(client, triggerId, userId, caseId, role) {
  const review = await getPerformanceReviewCase(caseId);
  if (!review) throw new Error('This performance review could not be found.');
  if (role === 'employee' && review.employeeSlackId !== userId) throw new Error('This assessment is only available to the employee under review.');
  if (role === 'manager' && review.managerSlackId !== userId) throw new Error('This assessment is only available to the assigned manager.');
  if (!['Initial Review Open', 'Discussion Open'].includes(review.status)) throw new Error('This assessment is no longer available for editing.');
  if (review.status === 'Discussion Open' && review.discussionDueDate < todayDateString()) throw new Error('The appraisal discussion deadline has passed. This case is now being closed or escalated by HR.');

  const existing = role === 'employee'
    ? { scores: review.employeeScores, comments: review.employeeComments }
    : { scores: review.managerScores, comments: review.managerComments };

  await client.views.open({
    trigger_id: triggerId,
    view: buildAssessmentModal({
      caseId,
      role,
      employeeName: review.employeeName,
      contractEndDate: review.contractEndDate,
      initialDueDate: review.initialDueDate,
      existing,
    }),
  });
}

async function openDiscussionIfReady(client, caseId) {
  const review = await getPerformanceReviewCase(caseId);
  if (!review || review.status !== 'Initial Review Open' || !review.employeeSubmittedAt || !review.managerSubmittedAt) return;

  const discussionDueDate = addBusinessDays(todayDateString(), DISCUSSION_WINDOW_DAYS);
  await updatePerformanceReviewCase(caseId, { status: 'Discussion Open', discussionDueDate });
  await appendPerformanceReviewAudit(caseId, { type: 'discussion_opened', by: 'system', discussionDueDate });

  const employeeSummary = formatAssessment(review.employeeScores, review.employeeOverall, review.employeeComments);
  const managerSummary = formatAssessment(review.managerScores, review.managerOverall, review.managerComments);
  await Promise.all([
    sendPrivate(client, review.employeeSlackId, {
      text: `🤝 Appraisal discussion window opened — ${review.employeeName}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `🤝 *Appraisal Discussion Window Open*\n\nYour manager's assessment is now visible. They will propose meeting times and a conference room for the discussion. After the meeting, you may revise your own assessment before *${formatDate(discussionDueDate)}*.\n\n*Your Assessment*\n${employeeSummary}\n\n*Manager Assessment*\n${managerSummary}` } },
        { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Update My Self-Assessment', emoji: true }, action_id: 'open_self_assessment', value: reviewActionValue(caseId) }] },
      ],
    }),
    sendPrivate(client, review.managerSlackId, {
      text: `🤝 Appraisal discussion window opened — ${review.employeeName}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `🤝 *Appraisal Discussion Window Open — ${review.employeeName}*\n\nBoth initial assessments are now visible. Please propose 2–3 real room/time options within the next 2 business days. Both parties may revise their own assessment after the meeting and before *${formatDate(discussionDueDate)}*.\n\n*Employee Assessment*\n${employeeSummary}\n\n*Manager Assessment*\n${managerSummary}` } },
        { type: 'actions', elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Schedule Appraisal Meeting', emoji: true }, style: 'primary', action_id: 'schedule_appraisal_meeting', value: reviewActionValue(caseId) },
          { type: 'button', text: { type: 'plain_text', text: 'Update My Manager Assessment', emoji: true }, action_id: 'open_manager_assessment', value: reviewActionValue(caseId) },
        ] },
      ],
    }),
  ]);
}

async function getRoomAvailability(date) {
  if (!HR_ROOM_BOOKING_URL || !HR_ROOM_BOOKING_SECRET) throw new Error('Room booking integration is not configured. Contact HR.');
  const response = await fetch(`${HR_ROOM_BOOKING_URL}/availability?date=${encodeURIComponent(date)}`, {
    headers: { 'x-hr-booking-secret': HR_ROOM_BOOKING_SECRET },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to retrieve conference-room availability.');
  return payload;
}

async function createRoomBooking(caseId, selection) {
  if (!HR_ROOM_BOOKING_URL || !HR_ROOM_BOOKING_SECRET) throw new Error('Room booking integration is not configured. Contact HR.');
  const response = await fetch(`${HR_ROOM_BOOKING_URL}/appraisal-bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hr-booking-secret': HR_ROOM_BOOKING_SECRET },
    body: JSON.stringify({ caseId, date: selection.date, roomId: selection.roomId, slotHour: selection.slotHour }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to create the room booking.');
  return payload;
}

async function cancelRoomBooking(caseId, bookingId) {
  if (!HR_ROOM_BOOKING_URL || !HR_ROOM_BOOKING_SECRET) throw new Error('Room booking integration is not configured. Contact HR.');
  const response = await fetch(`${HR_ROOM_BOOKING_URL}/appraisal-bookings/${bookingId}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', 'x-hr-booking-secret': HR_ROOM_BOOKING_SECRET },
    body: JSON.stringify({ caseId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to cancel the room booking.');
  return payload;
}

function meetingOptionText(option) {
  return `${option.roomName} · ${formatDate(option.date)} · ${String(option.slotHour).padStart(2, '0')}:00–${String(option.slotHour + 1).padStart(2, '0')}:00`;
}

async function notifyEscalation(client, review) {
  const employeeSummary = formatAssessment(review.employeeScores, review.employeeOverall, review.employeeComments);
  const managerSummary = formatAssessment(review.managerScores, review.managerOverall, review.managerComments);
  const actionValue = reviewActionValue(review.caseId);
  const content = `⚠️ *Performance Appraisal Escalation Required*\n\n*Employee:* <@${review.employeeSlackId}> (${review.employeeName})\n*Manager:* <@${review.managerSlackId}>\n*Review Type:* ${review.reviewType}\n*Contract End Date:* ${review.contractEndDate ? formatDate(review.contractEndDate) : 'Not applicable'}\n*Unused Annual Leave:* ${review.annualBalance} day(s)\n*Employee Meeting Status:* ${review.employeeMeetingStatus || 'No response'}\n*Manager Meeting Status:* ${review.managerMeetingStatus || 'No response'}\n\n*Employee Assessment*\n${employeeSummary}\n\n*Manager Assessment*\n${managerSummary}`;
  const message = {
    text: `⚠️ Appraisal escalation — ${review.employeeName}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: content } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Record HR / CEO Decision', emoji: true }, style: 'primary', action_id: 'open_performance_hr_resolution', value: actionValue }] },
    ],
  };
  await Promise.all([sendPrivate(client, HR_MANAGER_ID, message), sendPrivate(client, OWNER_SLACK_ID, message)]);
  await sendPrivate(client, review.managerSlackId, { text: `⚠️ The final overall rating remains different from ${review.employeeName}'s rating. The case has been automatically sent to HR and the CEO for review.` });
  await sendPrivate(client, review.employeeSlackId, { text: '⚠️ Your final overall appraisal rating remains different from your manager’s rating. HR and the CEO will review the documented case and notify you of the final decision.' });
}

async function processPerformanceReviewDeadlines(client) {
  const reviews = await getAllPerformanceReviews();
  const today = todayDateString();
  for (const review of reviews) {
    try {
      if (review.status === 'Initial Review Open' && review.initialDueDate < today && (!review.employeeSubmittedAt || !review.managerSubmittedAt)) {
        await updatePerformanceReviewCase(review.caseId, { status: 'Initial Submission Overdue' });
        const missing = [!review.employeeSubmittedAt ? 'employee self-assessment' : '', !review.managerSubmittedAt ? 'manager assessment' : ''].filter(Boolean).join(' and ');
        await Promise.all([
          sendPrivate(client, HR_MANAGER_ID, { text: `⚠️ *Initial performance review submission overdue*\n\n*Employee:* ${review.employeeName}\n*Missing:* ${missing}\n*Initial deadline:* ${formatDate(review.initialDueDate)}` }),
          sendPrivate(client, review.managerSlackId, { text: `⚠️ Initial performance review submission overdue for *${review.employeeName}*. Missing: ${missing}. Please coordinate with HR.` }),
        ]);
      }
      if (review.status === 'Discussion Open') {
        const auditTypes = new Set(review.revisionAudit.map((event) => event.type));
        const discussionDaysRemaining = daysUntil(review.discussionDueDate);
        if (!review.meetingOptions.length && discussionDaysRemaining <= 8 && !auditTypes.has('meeting_scheduling_reminder_sent')) {
          await Promise.all([
            sendPrivate(client, review.managerSlackId, { text: `⏰ Please schedule the appraisal discussion for *${review.employeeName}*. Use the *Schedule Appraisal Meeting* button before *${formatDate(review.discussionDueDate)}*.` }),
            sendPrivate(client, HR_MANAGER_ID, { text: `⏰ Meeting scheduling reminder sent to <@${review.managerSlackId}> for *${review.employeeName}*'s appraisal.` }),
          ]);
          await appendPerformanceReviewAudit(review.caseId, { type: 'meeting_scheduling_reminder_sent', by: 'system' });
        }
        if (review.meetingOptions.length && !review.meetingSelected && !auditTypes.has('employee_meeting_selection_reminder_sent')) {
          const proposedAt = review.revisionAudit.find((event) => event.type === 'meeting_options_proposed')?.at;
          if (proposedAt && (Date.now() - new Date(proposedAt).getTime()) >= 86400000) {
            await Promise.all([
              sendPrivate(client, review.employeeSlackId, { text: `⏰ Please select one proposed appraisal-meeting option for your review with *${review.employeeName}*. If none work, contact your manager promptly so they can send alternatives.` }),
              sendPrivate(client, review.managerSlackId, { text: `⏰ ${review.employeeName} has not selected an appraisal-meeting option yet. Please follow up with them.` }),
            ]);
            await appendPerformanceReviewAudit(review.caseId, { type: 'employee_meeting_selection_reminder_sent', by: 'system' });
          }
        }
        if (review.meetingSelected && review.meetingSelected.date < today && !auditTypes.has('meeting_status_check_sent')) {
          await sendPrivate(client, review.employeeSlackId, {
            text: `📋 Appraisal meeting status — ${review.employeeName}`,
            blocks: [
              { type: 'section', text: { type: 'mrkdwn', text: `Please document what happened with your scheduled appraisal meeting for *${review.employeeName}*. Your answer becomes part of the review record if HR and the CEO need to review the case.` } },
              {
                type: 'actions',
                elements: [
                  { type: 'button', text: { type: 'plain_text', text: 'Meeting Completed', emoji: true }, style: 'primary', action_id: 'employee_meeting_status', value: JSON.stringify({ caseId: review.caseId, status: 'Meeting Completed' }) },
                  { type: 'button', text: { type: 'plain_text', text: 'Meeting Not Held', emoji: true }, action_id: 'employee_meeting_status', value: JSON.stringify({ caseId: review.caseId, status: 'Meeting Not Held' }) },
                  { type: 'button', text: { type: 'plain_text', text: 'Manager Did Not Attend', emoji: true }, style: 'danger', action_id: 'employee_meeting_status', value: JSON.stringify({ caseId: review.caseId, status: 'Manager Did Not Attend' }) },
                  { type: 'button', text: { type: 'plain_text', text: 'I Need HR Support', emoji: true }, action_id: 'employee_meeting_status', value: JSON.stringify({ caseId: review.caseId, status: 'Need HR Support' }) },
                ],
              },
            ],
          });
          await sendPrivate(client, review.managerSlackId, {
            text: `📋 Confirm appraisal meeting status — ${review.employeeName}`,
            blocks: [
              { type: 'section', text: { type: 'mrkdwn', text: `Please document the status of your appraisal meeting with *${review.employeeName}*.` } },
              {
                type: 'actions',
                elements: [
                  { type: 'button', text: { type: 'plain_text', text: 'Meeting Completed', emoji: true }, style: 'primary', action_id: 'manager_meeting_status', value: JSON.stringify({ caseId: review.caseId, status: 'Meeting Completed' }) },
                  { type: 'button', text: { type: 'plain_text', text: 'Employee Did Not Attend', emoji: true }, action_id: 'manager_meeting_status', value: JSON.stringify({ caseId: review.caseId, status: 'Employee Did Not Attend' }) },
                  { type: 'button', text: { type: 'plain_text', text: 'Meeting Rescheduled', emoji: true }, action_id: 'manager_meeting_status', value: JSON.stringify({ caseId: review.caseId, status: 'Meeting Rescheduled' }) },
                  { type: 'button', text: { type: 'plain_text', text: 'Need HR Support', emoji: true }, action_id: 'manager_meeting_status', value: JSON.stringify({ caseId: review.caseId, status: 'Need HR Support' }) },
                ],
              },
            ],
          });
          await appendPerformanceReviewAudit(review.caseId, { type: 'meeting_status_check_sent', by: 'system' });
        }
      }
      if (review.status === 'Discussion Open' && review.discussionDueDate < today) {
        if (review.employeeOverall === review.managerOverall) {
          await updatePerformanceReviewCase(review.caseId, { status: 'Awaiting Manager Outcome' });
          await appendPerformanceReviewAudit(review.caseId, { type: 'appraisal_ratings_aligned_at_deadline', by: 'system', finalOverall: review.managerOverall });
          await sendPrivate(client, review.managerSlackId, {
            text: `✅ Appraisal ratings aligned — ${review.employeeName}`,
            blocks: [
              { type: 'section', text: { type: 'mrkdwn', text: `The discussion window is closed. The final ratings match at *${review.managerOverall}/5 — ${scoreLabel(review.managerOverall)}*. Please record the renewal recommendation and agreed next goals.` } },
              { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Complete Appraisal Outcome', emoji: true }, style: 'primary', action_id: 'open_performance_final_decision', value: reviewActionValue(review.caseId) }] },
            ],
          });
        } else {
          const escalated = await updatePerformanceReviewCase(review.caseId, { status: 'Awaiting HR / CEO Resolution', escalatedAt: new Date().toISOString() });
          await appendPerformanceReviewAudit(review.caseId, { type: 'automatic_escalation', by: 'system', reason: 'Final overall ratings differ at deadline' });
          await notifyEscalation(client, escalated);
        }
      }
    } catch (error) {
      console.error(`[Performance Reviews] Deadline processing failed for ${review.caseId}`, error);
    }
  }
}

async function openContractReviewsDue(client) {
  const employees = await getAllEmployees();
  for (const employee of employees) {
    if (!employee.contractEndDate) continue;
    const daysToContractEnd = daysUntil(employee.contractEndDate);
    if (daysToContractEnd < 0 || daysToContractEnd > 75) continue;
    const existing = await getActivePerformanceReviewForEmployee(employee.slackUserId, 'Contract Renewal');
    if (existing) continue;
    try {
      await startPerformanceReviewCase(client, employee, 'Contract Renewal');
    } catch (error) {
      console.error(`[Performance Reviews] Unable to open contract review for ${employee.name}`, error);
    }
  }
}

async function startPerformanceReviewCase(client, employee, reviewType) {
  const openedAt = todayDateString();
  const review = {
    caseId: generateCaseId(),
    reviewType,
    openedAt,
    initialDueDate: addCalendarDays(openedAt, INITIAL_REVIEW_DAYS),
    employeeName: employee.name,
    employeeSlackId: employee.slackUserId,
    managerSlackId: employee.managerSlackId,
    contractEndDate: reviewType === 'Contract Renewal' ? employee.contractEndDate : '',
    annualBalance: employee.annualRemaining,
  };
  if (!review.managerSlackId) throw new Error(`No manager is recorded for ${employee.name}.`);
  await addPerformanceReviewCase(review);
  await appendPerformanceReviewAudit(review.caseId, { type: 'case_opened', by: 'system', reviewType });
  await notifyReviewOpened(client, review);
  return review;
}

async function sendMonthlyPerformanceReport(client) {
  const reviews = await getAllPerformanceReviews();
  const active = reviews.filter((review) => ['Initial Review Open', 'Initial Submission Overdue', 'Discussion Open'].includes(review.status));
  const escalated = reviews.filter((review) => review.status === 'Awaiting HR / CEO Resolution');
  const completedThisMonth = reviews.filter((review) => review.status === 'Completed' && review.resolvedAt?.slice(0, 7) === todayDateString().slice(0, 7));
  const month = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' });
  const actionItems = [...active, ...escalated]
    .map((review) => `• *${review.employeeName}* — ${review.reviewType}: ${review.status}${review.discussionDueDate ? ` (deadline: ${formatDate(review.discussionDueDate)})` : ''}`)
    .join('\n') || 'No active or escalated review cases.';

  await sendPrivate(client, HR_MANAGER_ID, {
    text: `📊 Monthly performance review report — ${month}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `📊 Performance Review Report — ${month}`, emoji: true } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Active Cases:*\n${active.length}` },
          { type: 'mrkdwn', text: `*Awaiting HR / CEO:*\n${escalated.length}` },
          { type: 'mrkdwn', text: `*Completed This Month:*\n${completedThisMonth.length}` },
          { type: 'mrkdwn', text: `*Total Cases on Record:*\n${reviews.length}` },
        ],
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*Cases Requiring Attention*\n${actionItems}` } },
    ],
  });
}

function registerPerformanceReviewHandlers(app) {
  app.command('/start-performance-review', async ({ command, ack, client, logger }) => {
    await ack();
    try {
      const requester = await getEmployeeBySlackId(command.user_id);
      if (!requester?.isManager && !isHrOrAdmin(command.user_id)) {
        await sendPrivate(client, command.user_id, { text: '⚠️ This command is available only to managers and HR.' });
        return;
      }
      await client.views.open({ trigger_id: command.trigger_id, view: buildStartReviewModal() });
    } catch (error) {
      logger.error('Unable to open performance-review form', error);
    }
  });

  app.view('performance_start_review_submit', async ({ ack, view, body, client, logger }) => {
    const employeeSlackId = view.state.values.review_employee.review_employee_select.selected_user;
    const reviewType = view.state.values.review_type.review_type_select.selected_option?.value;
    const errors = {};
    if (!employeeSlackId) errors.review_employee = 'Please select an employee.';
    if (!reviewType) errors.review_type = 'Please select a review type.';
    if (Object.keys(errors).length) return ack({ response_action: 'errors', errors });

    let didAck = false;
    try {
      const employee = await getEmployeeBySlackId(employeeSlackId);
      const requester = await getEmployeeBySlackId(body.user.id);
      if (!employee) return ack({ response_action: 'errors', errors: { review_employee: 'This employee is not registered in the HR system.' } });
      if (!isHrOrAdmin(body.user.id) && employee.managerSlackId !== body.user.id) {
        return ack({ response_action: 'errors', errors: { review_employee: 'You can start a review only for your direct reports.' } });
      }
      if (!employee.managerSlackId) return ack({ response_action: 'errors', errors: { review_employee: 'The employee does not have an assigned manager in the HR sheet.' } });
      const existing = await getActivePerformanceReviewForEmployee(employeeSlackId, reviewType);
      if (existing) return ack({ response_action: 'errors', errors: { review_employee: 'An active review of this type already exists for this employee.' } });
      if (!requester?.isManager && !isHrOrAdmin(body.user.id)) return ack({ response_action: 'errors', errors: { review_employee: 'Only managers or HR can start a review.' } });
      await ack();
      didAck = true;
      const review = await startPerformanceReviewCase(client, employee, reviewType);
      await sendPrivate(client, body.user.id, { text: `✅ ${reviewType} opened for *${employee.name}*. The employee and manager have been notified.` });
    } catch (error) {
      logger.error('Unable to start performance review', error);
      if (!didAck) await ack({ response_action: 'errors', errors: { review_employee: 'Unable to start this review. Please try again or contact HR.' } });
      else await sendPrivate(client, body.user.id, { text: '⚠️ Unable to start this review. Please try again or contact HR.' });
    }
  });

  app.action('open_self_assessment', async ({ ack, body, action, client, logger }) => {
    await ack();
    try { await openAssessment(client, body.trigger_id, body.user.id, safeJson(action.value, {}).caseId, 'employee'); }
    catch (error) { logger.error('Unable to open self assessment', error); await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message}` }); }
  });

  app.action('open_manager_assessment', async ({ ack, body, action, client, logger }) => {
    await ack();
    try { await openAssessment(client, body.trigger_id, body.user.id, safeJson(action.value, {}).caseId, 'manager'); }
    catch (error) { logger.error('Unable to open manager assessment', error); await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message}` }); }
  });

  app.view('performance_assessment_submit', async ({ ack, view, body, client, logger }) => {
    const { caseId, role } = safeJson(view.private_metadata, {});
    const { scores, comments, errors } = readAssessment(view);
    if (Object.keys(errors).length) return ack({ response_action: 'errors', errors });
    let didAck = false;
    try {
      const review = await getPerformanceReviewCase(caseId);
      if (!review) return ack({ response_action: 'errors', errors: { comments: 'Review case not found.' } });
      const expectedUser = role === 'employee' ? review.employeeSlackId : review.managerSlackId;
      if (body.user.id !== expectedUser) return ack({ response_action: 'errors', errors: { comments: 'You are not authorized to submit this assessment.' } });
      if (!['Initial Review Open', 'Discussion Open'].includes(review.status)) return ack({ response_action: 'errors', errors: { comments: 'This appraisal is no longer open for editing.' } });
      const rating = calculateOverallRating(scores);
      await ack();
      didAck = true;
      const isRevision = role === 'employee' ? Boolean(review.employeeSubmittedAt) : Boolean(review.managerSubmittedAt);
      const updates = role === 'employee'
        ? { employeeScores: scores, employeeOverall: rating.overall, employeeComments: comments, employeeSubmittedAt: new Date().toISOString() }
        : { managerScores: scores, managerOverall: rating.overall, managerComments: comments, managerSubmittedAt: new Date().toISOString() };
      await updatePerformanceReviewCase(caseId, updates);
      await appendPerformanceReviewAudit(caseId, { type: isRevision ? `${role}_assessment_revised` : `${role}_assessment_submitted`, by: body.user.id, overall: rating.overall });
      await sendPrivate(client, body.user.id, { text: `✅ Your ${role === 'employee' ? 'self' : 'manager'} assessment has been ${isRevision ? 'updated' : 'submitted'}: *${rating.overall}/5 — ${rating.label}*.` });
      if (role === 'employee') await sendPrivate(client, review.managerSlackId, { text: `📋 ${review.employeeName} has submitted their self-assessment.` });
      else await sendPrivate(client, review.employeeSlackId, { text: '📋 Your manager has submitted their assessment.' });
      await openDiscussionIfReady(client, caseId);
    } catch (error) {
      logger.error('Unable to submit performance assessment', error);
      if (!didAck) await ack({ response_action: 'errors', errors: { comments: 'Unable to submit. Please try again or contact HR.' } });
      else await sendPrivate(client, body.user.id, { text: '⚠️ Unable to save your assessment. Please try again or contact HR.' });
    }
  });

  app.action('schedule_appraisal_meeting', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const review = await getPerformanceReviewCase(safeJson(action.value, {}).caseId);
      if (!review || review.managerSlackId !== body.user.id || review.status !== 'Discussion Open') throw new Error('This meeting can no longer be scheduled from this request.');
      await client.views.open({ trigger_id: body.trigger_id, view: buildMeetingDateModal({ caseId: review.caseId, employeeName: review.employeeName, discussionDeadline: formatDate(review.discussionDueDate) }) });
    } catch (error) { logger.error('Unable to open meeting form', error); await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message}` }); }
  });

  app.view('performance_meeting_dates_submit', async ({ ack, view, body, client, logger }) => {
    const { caseId } = safeJson(view.private_metadata, {});
    const dates = [
      view.state.values.meeting_date_one?.date_one_pick?.selected_date,
      view.state.values.meeting_date_two?.date_two_pick?.selected_date,
      view.state.values.meeting_date_three?.date_three_pick?.selected_date,
    ].filter(Boolean);
    const uniqueDates = [...new Set(dates)];
    const errors = {};
    if (uniqueDates.length < 2) errors.meeting_date_two = 'Choose at least two different possible dates.';
    if (uniqueDates.some((date) => date < todayDateString())) errors.meeting_date_one = 'Choose dates from today onward.';
    if (Object.keys(errors).length) return ack({ response_action: 'errors', errors });
    let didAck = false;
    try {
      const review = await getPerformanceReviewCase(caseId);
      if (!review || review.managerSlackId !== body.user.id || review.status !== 'Discussion Open') return ack({ response_action: 'errors', errors: { meeting_date_one: 'This review is not available for meeting scheduling.' } });
      if (uniqueDates.some((date) => date > review.discussionDueDate)) {
        return ack({ response_action: 'errors', errors: { meeting_date_one: `Choose dates on or before the discussion deadline: ${formatDate(review.discussionDueDate)}.` } });
      }
      const availabilityByDate = await Promise.all(uniqueDates.map(getRoomAvailability));
      const usable = availabilityByDate.filter((availability) => availability.rooms.some((room) => room.availableHours.length));
      if (usable.length < 2) return ack({ response_action: 'errors', errors: { meeting_date_one: 'At least two selected dates have no free conference-room slots. Choose other dates.' } });
      await ack({ response_action: 'push', view: buildMeetingSlotsModal({ caseId, employeeName: review.employeeName, availabilityByDate: usable }) });
      didAck = true;
    } catch (error) {
      logger.error('Unable to retrieve room availability', error);
      if (!didAck) await ack({ response_action: 'errors', errors: { meeting_date_one: error.message || 'Unable to check room availability.' } });
      else await sendPrivate(client, body.user.id, { text: '⚠️ Unable to retrieve room availability. Please try again.' });
    }
  });

  app.view('performance_meeting_slots_submit', async ({ ack, view, body, client, logger }) => {
    const { caseId } = safeJson(view.private_metadata, {});
    const selections = [1, 2, 3]
      .map((index) => view.state.values[`slot_choice_${index}`]?.[`slot_choice_${index}_select`]?.selected_option?.value)
      .filter(Boolean)
      .map((value) => safeJson(value, null))
      .filter(Boolean);
    const errors = {};
    if (selections.length < 2) errors.slot_choice_2 = 'Select at least two meeting options.';
    if (new Set(selections.map((option) => `${option.date}|${option.roomId}|${option.slotHour}`)).size !== selections.length) errors.slot_choice_2 = 'Each meeting option must be different.';
    if (Object.keys(errors).length) return ack({ response_action: 'errors', errors });
    let didAck = false;
    try {
      const review = await getPerformanceReviewCase(caseId);
      if (!review || review.managerSlackId !== body.user.id || review.status !== 'Discussion Open') return ack({ response_action: 'errors', errors: { slot_choice_1: 'This review is not available for meeting scheduling.' } });
      await ack();
      didAck = true;
      await updatePerformanceReviewCase(caseId, { meetingOptions: selections });
      await appendPerformanceReviewAudit(caseId, { type: 'meeting_options_proposed', by: body.user.id, options: selections });
      await sendPrivate(client, review.employeeSlackId, {
        text: `📅 Choose an appraisal meeting time — ${review.employeeName}`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text: `Your manager has proposed appraisal-meeting options. Choose the one that suits your schedule. The room is confirmed automatically after your choice.` } },
          {
            type: 'actions',
            elements: [
              ...selections.map((option, index) => ({
                type: 'button',
                text: { type: 'plain_text', text: `Option ${index + 1}: ${meetingOptionText(option)}`, emoji: true },
                action_id: 'select_performance_meeting',
                value: JSON.stringify({ caseId, option }),
              })),
              { type: 'button', text: { type: 'plain_text', text: 'None of These Work', emoji: true }, action_id: 'no_performance_meeting_option', value: reviewActionValue(caseId) },
            ],
          },
        ],
      });
      await sendPrivate(client, review.managerSlackId, { text: `✅ Meeting options have been sent to ${review.employeeName}. You will be notified when they select one.` });
    } catch (error) {
      logger.error('Unable to send meeting options', error);
      if (!didAck) await ack({ response_action: 'errors', errors: { slot_choice_1: 'Unable to send meeting options. Please try again.' } });
      else await sendPrivate(client, body.user.id, { text: '⚠️ Unable to send meeting options. Please try again.' });
    }
  });

  app.action('select_performance_meeting', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const { caseId, option } = safeJson(action.value, {});
      const review = await getPerformanceReviewCase(caseId);
      if (!review || review.employeeSlackId !== body.user.id || review.status !== 'Discussion Open') throw new Error('This meeting option is no longer available.');
      const booking = await createRoomBooking(caseId, option);
      const selected = { ...option, bookingId: booking.bookingId, roomName: booking.room?.nameEn || option.roomName, selectedAt: new Date().toISOString() };
      await updatePerformanceReviewCase(caseId, { meetingSelected: selected });
      await appendPerformanceReviewAudit(caseId, { type: 'meeting_confirmed', by: body.user.id, meeting: selected });
      const meetingText = `📅 *Appraisal Meeting Confirmed*\n\n*Employee:* <@${review.employeeSlackId}>\n*Manager:* <@${review.managerSlackId}>\n*Room:* ${selected.roomName}\n*Date:* ${formatDate(selected.date)}\n*Time:* ${String(selected.slotHour).padStart(2, '0')}:00–${String(selected.slotHour + 1).padStart(2, '0')}:00\n\nAfter the meeting, the app will ask both of you to confirm the meeting status. You may revise your own appraisal before *${formatDate(review.discussionDueDate)}*.`;
      await Promise.all([
        sendPrivate(client, review.employeeSlackId, {
          text: '📅 Appraisal meeting confirmed',
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: meetingText } },
            { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Update My Self-Assessment', emoji: true }, action_id: 'open_self_assessment', value: reviewActionValue(caseId) }] },
          ],
        }),
        sendPrivate(client, review.managerSlackId, {
          text: '📅 Appraisal meeting confirmed',
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: meetingText } },
            { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Update My Manager Assessment', emoji: true }, action_id: 'open_manager_assessment', value: reviewActionValue(caseId) }] },
          ],
        }),
      ]);
    } catch (error) {
      logger.error('Unable to confirm appraisal meeting', error);
      await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message || 'That room slot is no longer available. Please ask your manager to send new options.'}` });
    }
  });

  app.action('no_performance_meeting_option', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const review = await getPerformanceReviewCase(safeJson(action.value, {}).caseId);
      if (!review || review.employeeSlackId !== body.user.id || review.status !== 'Discussion Open') throw new Error('This meeting selection is no longer available.');
      await appendPerformanceReviewAudit(review.caseId, { type: 'employee_rejected_meeting_options', by: body.user.id });
      await Promise.all([
        sendPrivate(client, review.employeeSlackId, { text: '✅ Your manager has been asked to send alternative meeting options.' }),
        sendPrivate(client, review.managerSlackId, {
          text: `📅 *New appraisal meeting options needed*\n\n${review.employeeName} indicated that none of the proposed options work. Please send new options before *${formatDate(review.discussionDueDate)}*.`,
          blocks: [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Choose New Meeting Options', emoji: true }, style: 'primary', action_id: 'schedule_appraisal_meeting', value: reviewActionValue(review.caseId) }] }],
        }),
      ]);
    } catch (error) {
      logger.error('Unable to record unavailable meeting options', error);
      await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message}` });
    }
  });

  app.action('employee_meeting_status', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const { caseId, status } = safeJson(action.value, {});
      const review = await getPerformanceReviewCase(caseId);
      if (!review || review.employeeSlackId !== body.user.id || review.status !== 'Discussion Open') throw new Error('This meeting-status request is no longer available.');
      await updatePerformanceReviewCase(caseId, { employeeMeetingStatus: status });
      await appendPerformanceReviewAudit(caseId, { type: 'employee_meeting_status_recorded', by: body.user.id, status });
      await sendPrivate(client, body.user.id, { text: `✅ Meeting status recorded: *${status}*.` });
      if (status === 'Need HR Support' || status === 'Manager Did Not Attend') {
        await sendPrivate(client, HR_MANAGER_ID, { text: `⚠️ *Appraisal meeting support required*\n\n*Employee:* ${review.employeeName}\n*Employee status:* ${status}` });
      }
    } catch (error) {
      logger.error('Unable to save employee meeting status', error);
      await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message}` });
    }
  });

  app.action('manager_meeting_status', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const { caseId, status } = safeJson(action.value, {});
      const review = await getPerformanceReviewCase(caseId);
      if (!review || review.managerSlackId !== body.user.id || review.status !== 'Discussion Open') throw new Error('This meeting-status request is no longer available.');
      await updatePerformanceReviewCase(caseId, { managerMeetingStatus: status });
      await appendPerformanceReviewAudit(caseId, { type: 'manager_meeting_status_recorded', by: body.user.id, status });
      await sendPrivate(client, body.user.id, { text: `✅ Meeting status recorded: *${status}*.` });
      if (status === 'Meeting Rescheduled' && review.meetingSelected?.bookingId) {
        await cancelRoomBooking(caseId, review.meetingSelected.bookingId);
        await updatePerformanceReviewCase(caseId, { meetingSelected: null, meetingOptions: [] });
        await appendPerformanceReviewAudit(caseId, { type: 'appraisal_meeting_booking_cancelled_for_reschedule', by: body.user.id });
        await Promise.all([
          sendPrivate(client, review.managerSlackId, {
            text: `📅 The previous room reservation has been cancelled. Please select new available appraisal-meeting options for *${review.employeeName}*.`,
            blocks: [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Schedule New Meeting', emoji: true }, style: 'primary', action_id: 'schedule_appraisal_meeting', value: reviewActionValue(caseId) }] }],
          }),
          sendPrivate(client, review.employeeSlackId, { text: `📅 Your appraisal meeting is being rescheduled. Your manager will send new room/time options shortly.` }),
        ]);
      }
      if (status === 'Need HR Support') {
        await sendPrivate(client, HR_MANAGER_ID, { text: `⚠️ *Appraisal meeting support required*\n\n*Employee:* ${review.employeeName}\n*Manager status:* ${status}` });
      }
    } catch (error) {
      logger.error('Unable to save manager meeting status', error);
      await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message}` });
    }
  });

  app.action('open_performance_final_decision', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      const review = await getPerformanceReviewCase(safeJson(action.value, {}).caseId);
      if (!review || review.status !== 'Awaiting Manager Outcome' || review.managerSlackId !== body.user.id || review.employeeOverall !== review.managerOverall) throw new Error('This final decision is not available.');
      await client.views.open({ trigger_id: body.trigger_id, view: buildFinalDecisionModal({ caseId: review.caseId, employeeName: review.employeeName, finalOverall: review.managerOverall, reviewType: review.reviewType, contractEndDate: review.contractEndDate }) });
    } catch (error) { logger.error('Unable to open final decision', error); await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message}` }); }
  });

  app.view('performance_final_decision_submit', async ({ ack, view, body, client, logger }) => {
    const { caseId } = safeJson(view.private_metadata, {});
    const nextGoals = view.state.values.next_goals?.next_goals_input?.value?.trim();
    const managerFinalNotes = view.state.values.manager_final_notes?.manager_final_notes_input?.value?.trim() || '';
    const review = await getPerformanceReviewCase(caseId);
    const renewalOutcome = review?.reviewType === 'Contract Renewal' ? view.state.values.renewal_outcome?.renewal_outcome_select?.selected_option?.value : 'Semi-Annual Review Completed';
    const errors = {};
    if (!nextGoals) errors.next_goals = 'Please document the agreed goals, KPIs, or development priorities.';
    if (review?.reviewType === 'Contract Renewal' && !renewalOutcome) errors.renewal_outcome = 'Please select a renewal recommendation.';
    if (Object.keys(errors).length) return ack({ response_action: 'errors', errors });
    let didAck = false;
    try {
      if (!review || review.status !== 'Awaiting Manager Outcome' || review.managerSlackId !== body.user.id || review.employeeOverall !== review.managerOverall) return ack({ response_action: 'errors', errors: { next_goals: 'You are not authorized to complete this appraisal.' } });
      await ack();
      didAck = true;
      const completed = await updatePerformanceReviewCase(caseId, { status: 'Completed', finalRating: review.managerOverall, renewalOutcome, nextGoals, finalNotes: managerFinalNotes, resolvedAt: new Date().toISOString() });
      await appendPerformanceReviewAudit(caseId, { type: 'manager_completed_appraisal', by: body.user.id, finalRating: review.managerOverall, renewalOutcome });
      const summary = `✅ *Performance Appraisal Completed*\n\n*Employee:* <@${review.employeeSlackId}>\n*Final Rating:* *${review.managerOverall}/5 — ${scoreLabel(review.managerOverall)}*\n*Outcome:* ${renewalOutcome}\n*Agreed Goals / KPIs:*\n${nextGoals}${managerFinalNotes ? `\n\n*Manager Notes:*\n${managerFinalNotes}` : ''}`;
      await Promise.all([
        sendPrivate(client, review.employeeSlackId, { text: `✅ Performance appraisal completed`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: summary } }] }),
        sendPrivate(client, HR_MANAGER_ID, { text: `✅ Performance appraisal completed — ${review.employeeName}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: summary } }] }),
      ]);
      return completed;
    } catch (error) {
      logger.error('Unable to complete appraisal', error);
      if (!didAck) await ack({ response_action: 'errors', errors: { next_goals: 'Unable to save the outcome. Please try again.' } });
      else await sendPrivate(client, body.user.id, { text: '⚠️ Unable to save the appraisal outcome. Please try again.' });
    }
  });

  app.action('open_performance_hr_resolution', async ({ ack, body, action, client, logger }) => {
    await ack();
    try {
      if (!isHrOrAdmin(body.user.id)) throw new Error('Only HR may record the final HR / CEO decision.');
      const review = await getPerformanceReviewCase(safeJson(action.value, {}).caseId);
      if (!review || review.status !== 'Awaiting HR / CEO Resolution') throw new Error('This case is not awaiting HR / CEO resolution.');
      await client.views.open({ trigger_id: body.trigger_id, view: buildHrResolutionModal({ caseId: review.caseId, employeeName: review.employeeName, employeeOverall: review.employeeOverall, managerOverall: review.managerOverall, contractEndDate: review.contractEndDate }) });
    } catch (error) { logger.error('Unable to open HR resolution', error); await sendPrivate(client, body.user.id, { text: `⚠️ ${error.message}` }); }
  });

  app.view('performance_hr_resolution_submit', async ({ ack, view, body, client, logger }) => {
    const { caseId } = safeJson(view.private_metadata, {});
    const finalRating = Number(view.state.values.final_rating?.final_rating_select?.selected_option?.value);
    const renewalOutcome = view.state.values.renewal_outcome?.renewal_outcome_select?.selected_option?.value;
    const resolutionNotes = view.state.values.resolution_notes?.resolution_notes_input?.value?.trim();
    const nextGoals = view.state.values.next_goals?.next_goals_input?.value?.trim() || '';
    const errors = {};
    if (!finalRating) errors.final_rating = 'Please select the final approved rating.';
    if (!renewalOutcome) errors.renewal_outcome = 'Please select the final renewal outcome.';
    if (!resolutionNotes) errors.resolution_notes = 'Please record the HR / CEO decision notes.';
    if (Object.keys(errors).length) return ack({ response_action: 'errors', errors });
    let didAck = false;
    try {
      if (!isHrOrAdmin(body.user.id)) return ack({ response_action: 'errors', errors: { resolution_notes: 'Only HR may record this decision.' } });
      const review = await getPerformanceReviewCase(caseId);
      if (!review || review.status !== 'Awaiting HR / CEO Resolution') return ack({ response_action: 'errors', errors: { resolution_notes: 'This case is not available for resolution.' } });
      await ack();
      didAck = true;
      const status = renewalOutcome === 'Further Discussion Required' ? 'Awaiting HR / CEO Resolution' : 'Completed';
      await updatePerformanceReviewCase(caseId, { status, finalRating, renewalOutcome, nextGoals, hrCeoDecision: resolutionNotes, resolvedAt: status === 'Completed' ? new Date().toISOString() : '' });
      await appendPerformanceReviewAudit(caseId, { type: 'hr_ceo_resolution_recorded', by: body.user.id, finalRating, renewalOutcome });
      const summary = `📋 *HR / CEO Performance Review Decision*\n\n*Employee:* <@${review.employeeSlackId}>\n*Final Approved Rating:* *${finalRating}/5 — ${scoreLabel(finalRating)}*\n*Outcome:* ${renewalOutcome}\n*Decision Notes:*\n${resolutionNotes}${nextGoals ? `\n\n*Next Goals / Improvement Plan:*\n${nextGoals}` : ''}`;
      await Promise.all([
        sendPrivate(client, review.employeeSlackId, { text: '📋 HR / CEO appraisal decision recorded', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: summary } }] }),
        sendPrivate(client, review.managerSlackId, { text: '📋 HR / CEO appraisal decision recorded', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: summary } }] }),
        sendPrivate(client, HR_MANAGER_ID, { text: `📋 Appraisal case resolved — ${review.employeeName}`, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: summary } }] }),
      ]);
    } catch (error) {
      logger.error('Unable to record HR resolution', error);
      if (!didAck) await ack({ response_action: 'errors', errors: { resolution_notes: 'Unable to save this decision. Please try again.' } });
      else await sendPrivate(client, body.user.id, { text: '⚠️ Unable to record the HR / CEO decision. Please try again.' });
    }
  });
}

module.exports = {
  registerPerformanceReviewHandlers,
  startPerformanceReviewCase,
  processPerformanceReviewDeadlines,
  openContractReviewsDue,
  sendMonthlyPerformanceReport,
};
