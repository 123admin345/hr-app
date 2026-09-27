const { PERFORMANCE_CATEGORIES, getScoreOptions, scoreLabel } = require('../utils/performance');

function assessmentIntro(role, employeeName, contractEndDate, initialDueDate) {
  const reviewerLabel = role === 'employee' ? 'Self-Assessment' : 'Manager Assessment';
  const guidance = role === 'employee'
    ? 'Rate your own performance honestly against each category. Include concrete achievements, challenges, and support you need.'
    : `Rate ${employeeName}'s performance independently against each category. Include evidence, achievements, concerns, and development priorities.`;
  const contractLine = contractEndDate ? `\n*Contract End Date:* ${contractEndDate}` : '';
  const dueLine = initialDueDate ? `\n*Initial Submission Deadline:* ${initialDueDate}` : '';
  return `*${reviewerLabel}*\n${guidance}${contractLine}${dueLine}\n\n*Rating scale:* 1 = Below Expectations · 2 = Needs Improvement · 3 = Meets Expectations · 4 = Exceeds Expectations · 5 = Outstanding`;
}

function getInitialOption(score) {
  if (!score) return undefined;
  return {
    text: { type: 'plain_text', text: `${score} — ${scoreLabel(score)}`, emoji: true },
    value: String(score),
  };
}

function buildStartReviewModal() {
  return {
    type: 'modal',
    callback_id: 'performance_start_review_submit',
    title: { type: 'plain_text', text: 'Start Performance Review', emoji: true },
    submit: { type: 'plain_text', text: 'Open Review', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: 'Start an individual review for one of your direct reports. The employee and manager first complete independent assessments.' },
      },
      {
        type: 'input',
        block_id: 'review_employee',
        label: { type: 'plain_text', text: 'Employee', emoji: true },
        element: {
          type: 'users_select',
          action_id: 'review_employee_select',
          placeholder: { type: 'plain_text', text: 'Select employee', emoji: true },
        },
      },
      {
        type: 'input',
        block_id: 'review_type',
        label: { type: 'plain_text', text: 'Review Type', emoji: true },
        element: {
          type: 'static_select',
          action_id: 'review_type_select',
          options: [
            { text: { type: 'plain_text', text: 'Contract Renewal Review', emoji: true }, value: 'Contract Renewal' },
            { text: { type: 'plain_text', text: 'Semi-Annual Review', emoji: true }, value: 'Semi-Annual' },
          ],
        },
      },
    ],
  };
}

function buildAssessmentModal({ caseId, role, employeeName, contractEndDate, initialDueDate, existing = {} }) {
  const title = role === 'employee' ? 'Self Assessment' : 'Manager Assessment';
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: assessmentIntro(role, employeeName, contractEndDate, initialDueDate) },
    },
    { type: 'divider' },
  ];

  PERFORMANCE_CATEGORIES.forEach(({ key, label, description }) => {
    blocks.push({
      type: 'input',
      block_id: `score_${key}`,
      label: { type: 'plain_text', text: label, emoji: true },
      hint: { type: 'plain_text', text: description, emoji: true },
      element: {
        type: 'static_select',
        action_id: `score_${key}_select`,
        placeholder: { type: 'plain_text', text: 'Select a rating', emoji: true },
        options: getScoreOptions(),
        ...(getInitialOption(existing.scores?.[key]) ? { initial_option: getInitialOption(existing.scores[key]) } : {}),
      },
    });
  });

  blocks.push({
    type: 'input',
    block_id: 'comments',
    label: { type: 'plain_text', text: 'Comments, achievements, and development priorities', emoji: true },
    optional: true,
    element: {
      type: 'plain_text_input',
      action_id: 'comments_input',
      multiline: true,
      initial_value: existing.comments || '',
      placeholder: { type: 'plain_text', text: 'Add evidence, examples, development needs, or context.', emoji: true },
    },
  });

  return {
    type: 'modal',
    callback_id: 'performance_assessment_submit',
    private_metadata: JSON.stringify({ caseId, role }),
    title: { type: 'plain_text', text: title, emoji: true },
    submit: { type: 'plain_text', text: 'Submit Assessment', emoji: true },
    close: { type: 'plain_text', text: 'Close', emoji: true },
    blocks,
  };
}

function buildMeetingDateModal({ caseId, employeeName, discussionDeadline }) {
  return {
    type: 'modal',
    callback_id: 'performance_meeting_dates_submit',
    private_metadata: JSON.stringify({ caseId }),
    title: { type: 'plain_text', text: 'Schedule Appraisal Meeting', emoji: true },
    submit: { type: 'plain_text', text: 'Check Available Rooms', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Choose up to three possible dates for your appraisal discussion with *${employeeName}*. The app will retrieve only real available conference-room slots.\n\n*Discussion Deadline:* ${discussionDeadline}`,
        },
      },
      {
        type: 'input',
        block_id: 'meeting_date_one',
        label: { type: 'plain_text', text: 'First possible date', emoji: true },
        element: { type: 'datepicker', action_id: 'date_one_pick', placeholder: { type: 'plain_text', text: 'Select date', emoji: true } },
      },
      {
        type: 'input',
        block_id: 'meeting_date_two',
        label: { type: 'plain_text', text: 'Second possible date', emoji: true },
        element: { type: 'datepicker', action_id: 'date_two_pick', placeholder: { type: 'plain_text', text: 'Select date', emoji: true } },
      },
      {
        type: 'input',
        block_id: 'meeting_date_three',
        label: { type: 'plain_text', text: 'Third possible date (optional)', emoji: true },
        optional: true,
        element: { type: 'datepicker', action_id: 'date_three_pick', placeholder: { type: 'plain_text', text: 'Select date', emoji: true } },
      },
    ],
  };
}

function slotOptionsForDate(availability) {
  return availability.rooms.flatMap((room) => room.availableHours.map((hour) => ({
    text: { type: 'plain_text', text: `${room.nameEn} — ${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`, emoji: true },
    value: JSON.stringify({ date: availability.date, roomId: room.id, roomName: room.nameEn, slotHour: hour }),
  })));
}

function buildMeetingSlotsModal({ caseId, employeeName, availabilityByDate }) {
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `Choose *two or three* available room/time options to send to *${employeeName}*. Only live free slots are shown.` },
    },
  ];

  availabilityByDate.forEach((availability, index) => {
    const options = slotOptionsForDate(availability);
    if (options.length === 0) return;
    blocks.push({
      type: 'input',
      block_id: `slot_choice_${index + 1}`,
      label: { type: 'plain_text', text: `Option ${index + 1} — ${availability.date}`, emoji: true },
      ...(index === 2 ? { optional: true } : {}),
      element: {
        type: 'static_select',
        action_id: `slot_choice_${index + 1}_select`,
        placeholder: { type: 'plain_text', text: 'Choose a free room/time', emoji: true },
        options,
      },
    });
  });

  return {
    type: 'modal',
    callback_id: 'performance_meeting_slots_submit',
    private_metadata: JSON.stringify({ caseId }),
    title: { type: 'plain_text', text: 'Choose Meeting Options', emoji: true },
    submit: { type: 'plain_text', text: 'Send to Employee', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks,
  };
}

function buildFinalDecisionModal({ caseId, employeeName, finalOverall, reviewType, contractEndDate }) {
  const renewalFields = reviewType === 'Contract Renewal'
    ? [
      {
        type: 'input',
        block_id: 'renewal_outcome',
        label: { type: 'plain_text', text: 'Contract Renewal Recommendation', emoji: true },
        element: {
          type: 'static_select',
          action_id: 'renewal_outcome_select',
          placeholder: { type: 'plain_text', text: 'Select a recommendation', emoji: true },
          options: [
            { text: { type: 'plain_text', text: 'Renew Contract', emoji: true }, value: 'Renew Contract' },
            { text: { type: 'plain_text', text: 'Renew with Improvement Plan', emoji: true }, value: 'Renew with Improvement Plan' },
            { text: { type: 'plain_text', text: 'Do Not Renew', emoji: true }, value: 'Do Not Renew' },
          ],
        },
      },
    ]
    : [];

  return {
    type: 'modal',
    callback_id: 'performance_final_decision_submit',
    private_metadata: JSON.stringify({ caseId }),
    title: { type: 'plain_text', text: 'Complete Appraisal', emoji: true },
    submit: { type: 'plain_text', text: 'Confirm Outcome', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${employeeName}*\n*Final Agreed Rating:* *${finalOverall}/5 — ${scoreLabel(finalOverall)}*${contractEndDate ? `\n*Contract End Date:* ${contractEndDate}` : ''}` },
      },
      ...renewalFields,
      {
        type: 'input',
        block_id: 'next_goals',
        label: { type: 'plain_text', text: 'Agreed Goals / KPIs for the Next Period', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'next_goals_input',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Write the agreed goals, KPIs, development priorities, and support needed.', emoji: true },
        },
      },
      {
        type: 'input',
        block_id: 'manager_final_notes',
        label: { type: 'plain_text', text: 'Final Manager Comments', emoji: true },
        optional: true,
        element: { type: 'plain_text_input', action_id: 'manager_final_notes_input', multiline: true },
      },
    ],
  };
}

function buildHrResolutionModal({ caseId, employeeName, employeeOverall, managerOverall, contractEndDate }) {
  return {
    type: 'modal',
    callback_id: 'performance_hr_resolution_submit',
    private_metadata: JSON.stringify({ caseId }),
    title: { type: 'plain_text', text: 'Resolve Appraisal Case', emoji: true },
    submit: { type: 'plain_text', text: 'Record Final Decision', emoji: true },
    close: { type: 'plain_text', text: 'Cancel', emoji: true },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Employee:* ${employeeName}\n*Employee Rating:* ${employeeOverall}/5 — ${scoreLabel(employeeOverall)}\n*Manager Rating:* ${managerOverall}/5 — ${scoreLabel(managerOverall)}${contractEndDate ? `\n*Contract End Date:* ${contractEndDate}` : ''}\n\nRecord the outcome agreed with the CEO.`,
        },
      },
      {
        type: 'input',
        block_id: 'final_rating',
        label: { type: 'plain_text', text: 'Final Approved Rating', emoji: true },
        element: { type: 'static_select', action_id: 'final_rating_select', options: getScoreOptions() },
      },
      {
        type: 'input',
        block_id: 'renewal_outcome',
        label: { type: 'plain_text', text: 'Final Renewal Outcome', emoji: true },
        element: {
          type: 'static_select',
          action_id: 'renewal_outcome_select',
          options: [
            { text: { type: 'plain_text', text: 'Renew Contract', emoji: true }, value: 'Renew Contract' },
            { text: { type: 'plain_text', text: 'Renew with Improvement Plan', emoji: true }, value: 'Renew with Improvement Plan' },
            { text: { type: 'plain_text', text: 'Do Not Renew', emoji: true }, value: 'Do Not Renew' },
            { text: { type: 'plain_text', text: 'Further Discussion Required', emoji: true }, value: 'Further Discussion Required' },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'resolution_notes',
        label: { type: 'plain_text', text: 'HR / CEO Decision Notes', emoji: true },
        element: { type: 'plain_text_input', action_id: 'resolution_notes_input', multiline: true },
      },
      {
        type: 'input',
        block_id: 'next_goals',
        label: { type: 'plain_text', text: 'Approved Next Goals / Improvement Plan', emoji: true },
        optional: true,
        element: { type: 'plain_text_input', action_id: 'next_goals_input', multiline: true },
      },
    ],
  };
}

module.exports = {
  buildStartReviewModal,
  buildAssessmentModal,
  buildMeetingDateModal,
  buildMeetingSlotsModal,
  buildFinalDecisionModal,
  buildHrResolutionModal,
};
