const {
  SAUDI_HTC_VALUES,
  VALUE_RATING_SCALE_TEXT,
  getValueScoreOptions,
  getOverallRatingOptions,
  getKeeperOptions,
  getOkrScoreOptions,
  getOneToFiveScoreOptions,
} = require('../utils/saudiHtcPerformance');

function selectedOption(options, value) {
  if (value === undefined || value === null || value === '') return undefined;
  return options.find((option) => option.value === String(value));
}

function textInput({ blockId, actionId, label, placeholder, initialValue = '', optional = false, multiline = true, hint }) {
  return {
    type: 'input',
    block_id: blockId,
    label: { type: 'plain_text', text: label, emoji: true },
    ...(optional ? { optional: true } : {}),
    ...(hint ? { hint: { type: 'plain_text', text: hint, emoji: true } } : {}),
    element: {
      type: 'plain_text_input',
      action_id: actionId,
      multiline,
      ...(initialValue ? { initial_value: initialValue } : {}),
      ...(placeholder ? { placeholder: { type: 'plain_text', text: placeholder, emoji: true } } : {}),
    },
  };
}

function scoreInput({ blockId, actionId, label, description, initialScore, options, optional = false }) {
  const initialOption = selectedOption(options, initialScore);
  return {
    type: 'input',
    block_id: blockId,
    label: { type: 'plain_text', text: label, emoji: true },
    ...(optional ? { optional: true } : {}),
    ...(description ? { hint: { type: 'plain_text', text: description, emoji: true } } : {}),
    element: {
      type: 'static_select',
      action_id: actionId,
      placeholder: { type: 'plain_text', text: 'Select', emoji: true },
      options,
      ...(initialOption ? { initial_option: initialOption } : {}),
    },
  };
}

function reviewHeader({ employeeName, jobTitle, department, managerSlackId, reviewPeriod, reviewDate }) {
  return `*Saudi HTC Annual Performance Review & Growth Plan*\n\n*Employee Name:* ${employeeName || '—'}\n*Role/Title:* ${jobTitle || '—'}\n*Department:* ${department || '—'}\n*Manager:* ${managerSlackId ? `<@${managerSlackId}>` : '—'}\n*Review Period:* ${reviewPeriod || '—'}\n*Date of Review:* ${reviewDate || '—'}\n\n*Introduction*\nThis review evaluates your performance across three dimensions: Results (what you achieved), Values (how you achieved it), and Growth (your development journey). The process is designed to foster continuous improvement, strategic alignment, and open communication.`;
}

function addObjectivesInputs(blocks, objectives = [], owner) {
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Part 1: Performance Against Objectives (The "What")*\n\n*OKR Achievement Summary*\n${owner === 'employee'
        ? 'This is your first annual assessment. Please record the objectives you worked on during this review period because no earlier KPI/OKR plan was recorded in the HR system.'
        : 'For this later annual assessment, complete the objectives agreed in the previous Growth & Development Plan.'}\n\nFor each objective, complete Objective, Key Results, Target, Actual, and Score (0–1.0).`,
    },
  });
  [0, 1, 2].forEach((index) => {
    const objective = objectives[index] || {};
    const number = index + 1;
    blocks.push(
      textInput({ blockId: `annual_okr_${number}_title`, actionId: `annual_okr_${number}_title_input`, label: `Objective ${number}`, placeholder: `Objective ${number}`, initialValue: objective.title || '' }),
      textInput({ blockId: `annual_okr_${number}_key_results`, actionId: `annual_okr_${number}_key_results_input`, label: `Objective ${number} — Key Results`, placeholder: `KR ${number}.1\nKR ${number}.2`, initialValue: objective.keyResults || '' }),
      textInput({ blockId: `annual_okr_${number}_target`, actionId: `annual_okr_${number}_target_input`, label: `Objective ${number} — Target`, placeholder: 'Insert target.', initialValue: objective.target || '', multiline: false }),
      textInput({ blockId: `annual_okr_${number}_actual`, actionId: `annual_okr_${number}_actual_input`, label: `Objective ${number} — Actual`, placeholder: 'Insert actual result.', initialValue: objective.actual || '', multiline: false }),
      scoreInput({ blockId: `annual_okr_${number}_score`, actionId: `annual_okr_${number}_score_select`, label: `Objective ${number} — Score (0–1.0)`, initialScore: objective.score, options: getOkrScoreOptions() }),
    );
  });
}

function buildSaudiHtcAssessmentModal({ caseId, role, objectivesOwner = 'manager', employeeName, jobTitle, department, managerSlackId, reviewPeriod, reviewDate, initialDueDate, existing = {} }) {
  const existingScores = existing.scores || {};
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `${reviewHeader({ employeeName, jobTitle, department, managerSlackId, reviewPeriod, reviewDate })}\n\n*Initial submission deadline:* ${initialDueDate}` } },
    { type: 'divider' },
  ];

  if (role === 'employee') {
    if (objectivesOwner === 'employee') {
      addObjectivesInputs(blocks, existingScores.objectives || [], 'employee');
      blocks.push({ type: 'divider' });
    }
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Part 2: Living Our Values (The "How") — Saudi HTC 5Bs*\n\nRate yourself on each of Saudi HTC’s five core values. Complete your *Self-Rating* only; the manager completes the separate Manager Rating and Observations & Examples fields.\n\n*Rating scale — use this scale for every 5B:*\n${VALUE_RATING_SCALE_TEXT}` } });
    SAUDI_HTC_VALUES.forEach((value) => {
      blocks.push(scoreInput({
        blockId: `annual_self_value_${value.key}`,
        actionId: `annual_self_value_${value.key}_select`,
        label: `${value.label} — Self-Rating / 5`,
        description: value.description,
        initialScore: existingScores.values?.[value.key],
        options: getValueScoreOptions(),
      }));
    });
    blocks.push(
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*Part 5: Employee Self-Reflection*' } },
      textInput({
        blockId: 'annual_self_accomplishment', actionId: 'annual_self_accomplishment_input',
        label: '1. What accomplishment are you most proud of during this review period, and how did it align with our values?',
        placeholder: 'Insert response here.', initialValue: existingScores.reflections?.accomplishment || '',
      }),
      textInput({
        blockId: 'annual_self_challenge', actionId: 'annual_self_challenge_input',
        label: '2. What was your biggest challenge, and what did you learn from it?',
        placeholder: 'Insert response here.', initialValue: existingScores.reflections?.challenge || '',
      }),
      textInput({
        blockId: 'annual_self_support', actionId: 'annual_self_support_input',
        label: '3. What support or resources do you need from management to be more effective in the next period?',
        placeholder: 'Insert response here.', initialValue: existingScores.reflections?.support || '',
      }),
    );
  } else {
    if (objectivesOwner === 'manager') {
      addObjectivesInputs(blocks, existingScores.objectives || [], 'manager');
      blocks.push(
        textInput({
          blockId: 'annual_results_commentary', actionId: 'annual_results_commentary_input',
          label: 'Manager Commentary on Results',
          hint: 'Did the employee focus on the right priorities? How did they handle unforeseen obstacles? What was their overall impact?',
          placeholder: 'Insert commentary here.', initialValue: existingScores.resultsCommentary || '',
        }),
      );
    }
    blocks.push(
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*Part 2: Living Our Values (The "How") — Saudi HTC 5Bs*\n\nRate the employee on each value using the scale below. Complete the *Manager Rating* and *Observations & Examples* fields.\n\n*Rating scale — use this scale for every 5B:*\n${VALUE_RATING_SCALE_TEXT}` } },
    );
    SAUDI_HTC_VALUES.forEach((value) => {
      blocks.push(
        scoreInput({
          blockId: `annual_manager_value_${value.key}`, actionId: `annual_manager_value_${value.key}_select`,
          label: `${value.label} — Manager Rating / 5`, description: value.description,
          initialScore: existingScores.values?.[value.key], options: getValueScoreOptions(),
        }),
        textInput({
          blockId: `annual_manager_value_${value.key}_observation`, actionId: `annual_manager_value_${value.key}_observation_input`,
          label: `${value.label} — Observations & Examples`, placeholder: 'Insert observations here.',
          initialValue: existingScores.valueObservations?.[value.key] || '',
        }),
      );
    });
  }

  return {
    type: 'modal', callback_id: 'performance_assessment_submit', private_metadata: JSON.stringify({ caseId, role }),
    title: { type: 'plain_text', text: role === 'employee' ? 'Annual Self-Review' : 'Annual Manager Review', emoji: true },
    submit: { type: 'plain_text', text: 'Submit', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true }, blocks,
  };
}

function buildSaudiHtcFinalReviewModal({ caseId, objectivesOwner = 'manager', employeeName, jobTitle, department, managerSlackId, reviewPeriod, reviewDate, employeeScores = {}, existingFinalAssessment = {} }) {
  const finalAssessment = existingFinalAssessment || {};
  const project = finalAssessment.project || {};
  const feedback = finalAssessment.feedback360 || {};
  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: reviewHeader({ employeeName, jobTitle, department, managerSlackId, reviewPeriod, reviewDate }) } },
    { type: 'divider' },
  ];

  if (objectivesOwner === 'employee') {
    const objectives = employeeScores.objectives || [];
    const objectiveSummary = objectives.length
      ? objectives.map((objective, index) => `*Objective ${index + 1}:* ${objective.title || '—'}\n*Key Results:* ${objective.keyResults || '—'}\n*Target:* ${objective.target || '—'}\n*Actual:* ${objective.actual || '—'}\n*Score:* ${objective.score ?? '—'} / 1.0`).join('\n\n')
      : 'No employee objectives were recorded.';
    blocks.push(
      { type: 'section', text: { type: 'mrkdwn', text: `*Part 1: Performance Against Objectives (The "What") — Employee Self-Reported Objectives*\n\n${objectiveSummary}` } },
      textInput({
        blockId: 'annual_results_commentary', actionId: 'annual_results_commentary_input',
        label: 'Manager Commentary on Results',
        hint: 'Did the employee focus on the right priorities? How did they handle unforeseen obstacles? What was their overall impact?',
        placeholder: 'Insert commentary here.', initialValue: finalAssessment.resultsCommentary || '',
      }),
      { type: 'divider' },
    );
  }

  blocks.push(
    { type: 'section', text: { type: 'mrkdwn', text: '*Part 3: Project-Based Performance*\nFor employees involved in government projects or major initiatives.' } },
    textInput({ blockId: 'annual_project_name', actionId: 'annual_project_name_input', label: 'Project Name', placeholder: 'Insert project name.', initialValue: project.name || '', optional: true, multiline: false }),
    textInput({ blockId: 'annual_project_role', actionId: 'annual_project_role_input', label: 'Role', placeholder: 'Insert role.', initialValue: project.role || '', optional: true, multiline: false }),
    textInput({ blockId: 'annual_project_contribution', actionId: 'annual_project_contribution_input', label: 'Key Contributions', placeholder: 'Insert key contributions.', initialValue: project.contribution || '', optional: true }),
    textInput({ blockId: 'annual_project_client_feedback', actionId: 'annual_project_client_feedback_input', label: 'Client Feedback', placeholder: 'Insert client feedback.', initialValue: project.clientFeedback || '', optional: true }),
    scoreInput({ blockId: 'annual_project_score', actionId: 'annual_project_score_select', label: 'Project Rating (1–5)', initialScore: project.score, options: getOneToFiveScoreOptions(), optional: true }),
    textInput({ blockId: 'annual_average_project_score', actionId: 'annual_average_project_score_input', label: 'Average Project Score / 5', placeholder: 'Insert average project score.', initialValue: project.averageScore || '', optional: true, multiline: false }),
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: '*Part 4: 360-Degree Feedback Summary*\nManager synthesizes feedback collected from peers, direct reports, and cross-functional partners.' } },
    textInput({ blockId: 'annual_360_strengths', actionId: 'annual_360_strengths_input', label: 'Strengths Identified by Peers', placeholder: '1.\n2.\n3.', initialValue: feedback.strengths || '' }),
    textInput({ blockId: 'annual_360_growth', actionId: 'annual_360_growth_input', label: 'Areas for Growth Identified by Peers', placeholder: '1.\n2.\n3.', initialValue: feedback.areasForGrowth || '' }),
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: '*Part 6: Overall Performance Assessment*\n\n*Performance Rating Calculation*\nOKR Achievement — 40% — Score / 1.0\nValues Assessment — 30% — Score / 5\nProject Performance — 20% — Score / 5\n360 Feedback — 10% — Score / 5\nOverall Score — / 5\n\n*Approved Overall Rating Definitions*\n5 — Exceptional: Consistently exceeds all expectations; role model for the organization.\n4 — Exceeds Expectations: Frequently exceeds expectations; strong performer.\n3 — Meets Expectations: Consistently meets expectations; solid contributor.\n2 — Needs Improvement: Sometimes meets expectations; development needed.\n1 — Unsatisfactory: Does not meet expectations; immediate action required.' } },
    scoreInput({ blockId: 'annual_360_score', actionId: 'annual_360_score_select', label: '360 Feedback Score / 5', initialScore: feedback.score, options: getOneToFiveScoreOptions() }),
    textInput({ blockId: 'annual_overall_score', actionId: 'annual_overall_score_input', label: 'Overall Score / 5', placeholder: 'Insert overall score.', initialValue: finalAssessment.overallScore || '', multiline: false }),
    scoreInput({ blockId: 'annual_overall_rating', actionId: 'annual_overall_rating_select', label: 'Overall Performance Rating', initialScore: finalAssessment.overallRating, options: getOverallRatingOptions() }),
    textInput({ blockId: 'annual_manager_rationale', actionId: 'annual_manager_rationale_input', label: 'Manager Rationale for Overall Rating', placeholder: 'Insert rationale here.', initialValue: finalAssessment.managerRationale || '' }),
    { type: 'section', text: { type: 'mrkdwn', text: '*"Keeper" Assessment*\nIf this employee told me they were leaving for a similar job at a peer company, would I fight hard to keep them?\n\n*Top Talent:* Yes, absolutely. I would fight to keep them.\n*Valuable Contributor:* Yes, with some conditions. I would be disappointed if they left.\n*Performance Issue:* No, I would accept their resignation.' } },
    scoreInput({ blockId: 'annual_keeper_assessment', actionId: 'annual_keeper_assessment_select', label: 'Keeper Assessment', initialScore: finalAssessment.keeperAssessment, options: getKeeperOptions() }),
    textInput({ blockId: 'annual_keeper_rationale', actionId: 'annual_keeper_rationale_input', label: 'Keeper Assessment Rationale', placeholder: 'Insert rationale here.', initialValue: finalAssessment.keeperRationale || '' }),
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: '*Part 7: Growth & Development Plan*\n\n*Career Aspirations*' } },
    textInput({ blockId: 'annual_growth_short_term', actionId: 'annual_growth_short_term_input', label: 'Short-term (Next 12 months)', placeholder: 'Insert response here.', initialValue: finalAssessment.careerShortTerm || employeeScores.career?.shortTerm || '' }),
    textInput({ blockId: 'annual_growth_long_term', actionId: 'annual_growth_long_term_input', label: 'Long-term (Next 3–5 years)', placeholder: 'Insert response here.', initialValue: finalAssessment.careerLongTerm || employeeScores.career?.longTerm || '' }),
    { type: 'section', text: { type: 'mrkdwn', text: '*Actionable Development Goals*' } },
  );

  [1, 2, 3].forEach((number) => {
    const goal = finalAssessment.developmentGoals?.[number - 1] || {};
    blocks.push(
      textInput({ blockId: `annual_goal_${number}_skill`, actionId: `annual_goal_${number}_skill_input`, label: `Goal ${number} — Skill/Area to Improve`, placeholder: 'Insert skill/area.', initialValue: goal.skill || '', optional: true, multiline: false }),
      textInput({ blockId: `annual_goal_${number}_actions`, actionId: `annual_goal_${number}_actions_input`, label: `Goal ${number} — Action Steps`, placeholder: 'Insert action steps.', initialValue: goal.actionSteps || '', optional: true }),
      textInput({ blockId: `annual_goal_${number}_timeline`, actionId: `annual_goal_${number}_timeline_input`, label: `Goal ${number} — Timeline`, placeholder: 'Insert timeline.', initialValue: goal.timeline || '', optional: true, multiline: false }),
      textInput({ blockId: `annual_goal_${number}_clickup`, actionId: `annual_goal_${number}_clickup_input`, label: `Goal ${number} — ClickUp Task ID`, placeholder: 'Insert ClickUp Task ID.', initialValue: goal.clickUpTaskId || '', optional: true, multiline: false }),
    );
  });

  blocks.push(
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: '*Part 8: Core Message*\nOne or two sentences summarizing the employee’s current standing and key focus area.' } },
    textInput({ blockId: 'annual_core_message', actionId: 'annual_core_message_input', label: 'Core Message', placeholder: 'Insert core message here.', initialValue: finalAssessment.coreMessage || '' }),
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: '*Part 9: Signatures*' } },
    textInput({ blockId: 'annual_manager_signature', actionId: 'annual_manager_signature_input', label: 'Manager Signature', placeholder: 'Type your full name.', initialValue: finalAssessment.managerSignature || '', multiline: false }),
  );

  return {
    type: 'modal', callback_id: 'performance_final_decision_submit', private_metadata: JSON.stringify({ caseId }),
    title: { type: 'plain_text', text: 'Annual Review & Plan', emoji: true }, submit: { type: 'plain_text', text: 'Sign & Send to Employee', emoji: true }, close: { type: 'plain_text', text: 'Cancel', emoji: true }, blocks,
  };
}

function buildSaudiHtcEmployeeSignatureModal({ caseId, employeeName, finalAssessment = {} }) {
  return {
    type: 'modal', callback_id: 'annual_employee_signature_submit', private_metadata: JSON.stringify({ caseId }),
    title: { type: 'plain_text', text: 'Annual Review Signature', emoji: true },
    submit: { type: 'plain_text', text: 'Sign Annual Review', emoji: true }, close: { type: 'plain_text', text: 'Close', emoji: true },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*Saudi HTC Annual Performance Review & Growth Plan*\n\n*Employee:* ${employeeName}\n\n*Part 9: Signatures*\nPlease add your signature and optional comments. Your signature records that you have received and reviewed this document.` } },
      textInput({ blockId: 'annual_employee_signature', actionId: 'annual_employee_signature_input', label: 'Employee Signature', placeholder: 'Type your full name.', initialValue: finalAssessment.employeeSignature || '', multiline: false }),
      textInput({ blockId: 'annual_employee_comments_final', actionId: 'annual_employee_comments_final_input', label: 'Employee Comments (Optional)', placeholder: 'The employee may add any comments or responses to this review.', initialValue: finalAssessment.employeeComments || '', optional: true }),
    ],
  };
}

module.exports = {
  buildSaudiHtcAssessmentModal,
  buildSaudiHtcFinalReviewModal,
  buildSaudiHtcEmployeeSignatureModal,
};
