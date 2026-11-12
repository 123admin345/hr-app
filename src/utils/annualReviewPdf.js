'use strict';

const path = require('node:path');
const PDFDocument = require('pdfkit');
const {
  SAUDI_HTC_VALUES,
  VALUE_SCORE_LABELS,
  OVERALL_RATING_LABELS,
  OVERALL_RATING_OPTION_LABELS,
  KEEPER_OPTIONS,
  averageScores,
  averageObjectiveScores,
} = require('./saudiHtcPerformance');

// Approved wording from SaudiHTCAnnualPerformanceReviewandGrowthPlan(1).docx.
// This is a presentation/export layer: it does not assign ratings or calculate
// weighted/overall scores. Only the existing framework's simple averages are used.
const INTRODUCTION = 'This review evaluates your performance across three dimensions: Results (what you achieved), Values (how you achieved it), and Growth (your development journey). The process is designed to foster continuous improvement, strategic alignment, and open communication.';
const FOOTER = 'This form is part of the Saudi HTC Performance & Growth Framework. For questions or support, contact HR.';
const TITLES = [
  'Part 1: Performance Against Objectives (The "What")',
  'Part 2: Living Our Values (The "How")',
  'Part 3: Project-Based Performance',
  'Part 4: 360-Degree Feedback Summary',
  'Part 5: Employee Self-Reflection',
  'Part 6: Overall Performance Assessment',
  'Part 7: Growth & Development Plan',
  'Part 8: Core Message',
  'Part 9: Signatures',
];
const REFLECTIONS = [
  ['accomplishment', '1. What accomplishment are you most proud of during this review period, and how did it align with our values?'],
  ['challenge', '2. What was your biggest challenge, and what did you learn from it?'],
  ['support', '3. What support or resources do you need from management to be more effective in the next period?'],
];
const NOT_RECORDED = 'Not recorded';
const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const text = (value) => hasValue(value) ? String(value) : NOT_RECORDED;
const recordedScore = (value) => hasValue(value) ? value : null;
const array = (value) => Array.isArray(value) ? value : [];

/**
 * Build an immutable-by-copy print snapshot of this particular saved review.
 * Objectives ownership is deliberately not supplied by an option/current review
 * policy: historical records must use their own persisted owner or stored data.
 * Missing scores stay null (not zero). Project average/overall score/rating are
 * recorded entries, not derived values. No employee or manager data is mutated.
 */
function buildAnnualReviewPrintModel(review = {}, { employee = {}, managerName = '', fictionalSample = false } = {}) {
  review = review || {};
  employee = employee || {};
  const self = review.employeeScores || {};
  const manager = review.managerScores || {};
  const final = manager.finalAssessment || {};
  const objectivesOwner = ['employee', 'manager'].includes(final.objectivesOwner)
    ? final.objectivesOwner
    : array(self.objectives).length ? 'employee' : 'manager';
  const objectives = array(objectivesOwner === 'employee' ? self.objectives : manager.objectives)
    .map((objective = {}) => ({
      title: text(objective?.title), keyResults: text(objective?.keyResults),
      target: text(objective?.target), actual: text(objective?.actual), score: recordedScore(objective?.score),
    }));
  // Guard absent entries before invoking the approved helpers; Number(null) and
  // Number('') must never accidentally turn an unrecorded score into zero.
  const averageOkr = objectives.length && objectives.every((objective) => objective.score !== null)
    ? averageObjectiveScores(objectives) : null;
  let averageValues = null;
  if (SAUDI_HTC_VALUES.every(({ key }) => hasValue(manager.values?.[key]))) {
    try { averageValues = averageScores(manager.values); } catch { /* incomplete/invalid historical data */ }
  }
  const project = final.project || {};
  const feedback = final.feedback360 || {};
  const parts = [
    {
      number: 1, title: TITLES[0], objectivesOwner, objectives, averageOkr,
      resultsCommentary: text(final.resultsCommentary || manager.resultsCommentary),
      commentaryPrompt: 'Did the employee focus on the right priorities? How did they handle unforeseen obstacles? What was their overall impact?',
    },
    {
      number: 2, title: TITLES[1],
      instruction: "Rate the employee on each of Saudi HTC's five core values using the 1-5 scale.",
      scale: [5, 4, 3, 2, 1].map((score) => ({ score, description: VALUE_SCORE_LABELS[score] })),
      values: SAUDI_HTC_VALUES.map(({ key, label, description }) => ({
        key, label, description, selfScore: recordedScore(self.values?.[key]),
        managerScore: recordedScore(manager.values?.[key]), observation: text(manager.valueObservations?.[key]),
      })),
      averageValues,
    },
    {
      number: 3, title: TITLES[2], instruction: 'For employees involved in government projects or major initiatives.',
      project: {
        name: text(project.name), role: text(project.role), contribution: text(project.contribution),
        clientFeedback: text(project.clientFeedback), score: recordedScore(project.score),
        averageScore: recordedScore(project.averageScore),
      },
    },
    {
      number: 4, title: TITLES[3],
      instruction: 'Manager synthesizes feedback collected from peers, direct reports, and cross-functional partners.',
      strengths: text(feedback.strengths), areasForGrowth: text(feedback.areasForGrowth),
      score: recordedScore(feedback.score),
    },
    {
      number: 5, title: TITLES[4],
      reflections: REFLECTIONS.map(([key, question]) => ({ key, question, response: text(self.reflections?.[key]) })),
    },
    {
      number: 6, title: TITLES[5],
      components: [
        { label: 'OKR Achievement', weight: 40, score: averageOkr, scale: '1.0', weightedScore: null },
        { label: 'Values Assessment', weight: 30, score: averageValues, scale: '5', weightedScore: null },
        { label: 'Project Performance', weight: 20, score: recordedScore(project.averageScore), scale: '5', weightedScore: null },
        { label: '360 Feedback', weight: 10, score: recordedScore(feedback.score), scale: '5', weightedScore: null },
      ],
      weightedScoreNote: 'Component weighted scores were not recorded by the app. Dashes are intentional; the overall score and rating below are shown as recorded.',
      overallScore: recordedScore(final.overallScore), overallRating: recordedScore(final.overallRating),
      ratingDefinitions: [5, 4, 3, 2, 1].map((rating) => ({
        rating, label: OVERALL_RATING_OPTION_LABELS[rating],
        description: OVERALL_RATING_LABELS[rating].split(' - ').slice(1).join(' - '),
        selected: hasValue(final.overallRating) && String(final.overallRating) === String(rating),
      })),
      managerRationale: text(final.managerRationale), keeperAssessment: text(final.keeperAssessment),
      keeperPrompt: 'If this employee told me they were leaving for a similar job at a peer company, would I fight hard to keep them?',
      keeperOptions: KEEPER_OPTIONS.map((option) => ({ ...option, selected: final.keeperAssessment === option.value })),
      keeperRationale: text(final.keeperRationale),
    },
    {
      number: 7, title: TITLES[6], careerShortTerm: text(final.careerShortTerm), careerLongTerm: text(final.careerLongTerm),
      developmentGoals: array(final.developmentGoals).map((goal = {}) => ({
        skill: text(goal?.skill), actionSteps: text(goal?.actionSteps), timeline: text(goal?.timeline), clickUpTaskId: text(goal?.clickUpTaskId),
      })),
    },
    {
      number: 8, title: TITLES[7],
      instruction: "One or two sentences summarizing the employee's current standing and key focus area.",
      coreMessage: text(final.coreMessage),
    },
    {
      number: 9, title: TITLES[8],
      // Never fill the approved hard-copy lines with typed system entries.
      hardCopyLines: [
        { label: 'Manager', signature: 'Signature: ___________________', date: 'Date: ___________________' },
        { label: 'Employee', signature: 'Signature: ___________________', date: 'Date: ___________________' },
      ],
      systemRecord: {
        managerSignature: text(final.managerSignature), reviewDate: text(final.reviewDate),
        employeeSignature: text(final.employeeSignature), employeeSignatureDate: text(final.employeeSignatureDate),
      },
      employeeComments: text(final.employeeComments),
      commentsPrompt: 'The employee may add any comments or responses to this review.',
    },
  ];
  return {
    title: 'Saudi HTC Annual Performance Review & Growth Plan', introduction: INTRODUCTION, footer: FOOTER,
    fictionalSample: Boolean(fictionalSample),
    header: {
      classification: 'CONFIDENTIAL', caseId: text(review.caseId), status: text(review.status),
      employeeName: text(review.employeeName || employee.name), roleTitle: text(review.jobTitle || employee.jobTitle),
      department: text(review.department || employee.department),
      manager: text(managerName || (review.managerSlackId ? `Slack ID: ${review.managerSlackId}` : null)),
      employeeSlackId: text(review.employeeSlackId), managerSlackId: text(review.managerSlackId),
      reviewPeriod: text(review.reviewPeriod), reviewDate: text(final.reviewDate), openedAt: text(review.openedAt),
    },
    parts,
  };
}

const FONT_DIR = path.resolve(__dirname, '../../assets/fonts');
const FONT_FILES = {
  regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf',
  arabic: 'NotoSansArabic-Regular.ttf', arabicBold: 'NotoSansArabic-Bold.ttf',
};
const ARABIC = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
const LETTER = /\p{L}/u;
const NEUTRAL = /[\s\p{P}\p{M}\u200c\u200d]/u;
const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Fontkit shapes Arabic runs. Mixed text gets script-aware font fallback and
 * basic base-direction ordering, NOT a complete Unicode bidi implementation.
 * Latin and Arabic fonts are embedded/subset, so no host fonts are required.
 */
function fontRuns(value, bold) {
  const runs = [];
  let current = '';
  let script = 'latin';
  for (const character of value) {
    const next = ARABIC.test(character) ? 'arabic' : NEUTRAL.test(character) ? script : 'latin';
    if (next !== script && current) {
      runs.push({ text: current, font: script === 'arabic' ? (bold ? 'arabicBold' : 'arabic') : (bold ? 'bold' : 'regular') });
      current = '';
    }
    script = next;
    current += character;
  }
  if (current) runs.push({ text: current, font: script === 'arabic' ? (bold ? 'arabicBold' : 'arabic') : (bold ? 'bold' : 'regular') });
  const firstLetter = [...value].find((character) => LETTER.test(character));
  return { runs, rtl: Boolean(firstLetter && ARABIC.test(firstLetter)) };
}

function createRenderer(doc, model) {
  const LEFT = 44;
  const WIDTH = doc.page.width - LEFT * 2;
  const BOTTOM = doc.page.height - 70;
  const COLORS = { ink: '#24303E', muted: '#596575', teal: '#197B80', border: '#CDD9DF', pale: '#F1F6F7' };
  let y = 0;
  let contentTop = 0;
  const widthCache = new Map();

  function measure(value, size, bold = false) {
    const key = `${size}/${bold}/${value}`;
    if (widthCache.has(key)) return widthCache.get(key);
    // Explicit features bypass PDFKit's per-word layout cache, which otherwise
    // shapes Arabic words separately but leaves their visual order LTR.
    const width = fontRuns(value, bold).runs.reduce((sum, run) => sum + doc.font(run.font).fontSize(size).widthOfString(run.text, { features: [] }), 0);
    // Keep cache bounded for unusually long saved reviews.
    if (widthCache.size > 12000) widthCache.clear();
    widthCache.set(key, width);
    return width;
  }

  function wrap(value, width, size = 10, bold = false) {
    const lines = [];
    for (const paragraph of String(value).replace(/\r\n?/g, '\n').split('\n')) {
      if (!paragraph) { lines.push(''); continue; }
      let line = '';
      for (const word of paragraph.match(/\S+\s*|\s+/gu) || []) {
        if (measure(line + word, size, bold) <= width) { line += word; continue; }
        if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
        const trimmed = word.trimStart();
        if (measure(trimmed.trimEnd(), size, bold) <= width) { line = trimmed; continue; }
        // Long unbroken URLs/IDs/paragraph tokens are split at grapheme boundaries.
        for (const { segment } of graphemeSegmenter.segment(trimmed)) {
          if (line && measure(line + segment, size, bold) > width) { lines.push(line.trimEnd()); line = ''; }
          line += segment;
        }
      }
      if (line) lines.push(line.trimEnd());
    }
    return lines.length ? lines : [''];
  }

  function line(value, x, top, width, size = 10, bold = false, color = COLORS.ink) {
    const { runs, rtl } = fontRuns(value, bold);
    const visualRuns = rtl ? [...runs].reverse() : runs;
    let cursor = rtl ? x + width - measure(value, size, bold) : x;
    doc.fillColor(color);
    // PDFKit anchors each font using its ascender. Adjust to a shared baseline
    // so Arabic and Latin segments align on the same printed line.
    doc.font(bold ? 'bold' : 'regular').fontSize(size);
    const baselineAscender = doc._font.ascender;
    for (const run of visualRuns) {
      doc.font(run.font).fontSize(size);
      const offset = (baselineAscender - doc._font.ascender) * size / 1000;
      doc.text(run.text, cursor, top + offset, { lineBreak: false, features: [] });
      cursor += doc.widthOfString(run.text, { features: [] });
    }
  }

  function newPage(first = false) {
    if (!first) doc.addPage();
    const prefix = model.fictionalSample ? 'FICTIONAL SAMPLE | ' : '';
    line(`${prefix}${model.header.classification}  •  Saudi HTC Annual Review`, LEFT, 26, WIDTH, 8, true, COLORS.teal);
    const headerLines = wrap(`${prefix}Case: ${model.header.caseId}  |  Status: ${model.header.status}`, WIDTH, 8);
    headerLines.forEach((value, index) => line(value, LEFT, 42 + index * 13, WIDTH, 8, false, COLORS.muted));
    const ruleY = 45 + headerLines.length * 13;
    doc.moveTo(LEFT, ruleY).lineTo(LEFT + WIDTH, ruleY).lineWidth(0.7).strokeColor(COLORS.border).stroke();
    contentTop = ruleY + 17;
    if (contentTop > BOTTOM - 80) throw new Error('Annual review case/status header is too large for an A4 page.');
    y = contentTop;
  }

  function ensure(height) { if (y + height > BOTTOM) newPage(); }
  function gap(height = 8) { y += height; }
  function paragraph(value, { size = 10, bold = false, color = COLORS.ink, indent = 0, after = 8 } = {}) {
    const leading = size * 1.6;
    const lines = wrap(value, WIDTH - indent, size, bold);
    // Keep short paragraphs intact rather than orphan a final word/line. Truly
    // long narratives still flow line-by-line over as many pages as necessary.
    if (lines.length <= 8) ensure(lines.length * leading);
    for (const valueLine of lines) {
      ensure(leading);
      line(valueLine, LEFT + indent, y, WIDTH - indent, size, bold, color);
      y += leading;
    }
    gap(after);
  }
  function heading(value, major = false) {
    ensure(major ? 85 : 53);
    if (major) gap(8);
    paragraph(value, { size: major ? 14 : 11, bold: true, color: major ? COLORS.teal : COLORS.ink, after: major ? 12 : 6 });
  }
  function field(label, value, options) {
    const labelHeight = wrap(label, WIDTH, 11, true).length * 17.6 + 6;
    const valueHeight = wrap(text(value), WIDTH - 8, options?.size || 10).length * (options?.size || 10) * 1.6;
    ensure(labelHeight + Math.min(valueHeight, 112));
    heading(label);
    paragraph(text(value), { indent: 8, ...options });
  }
  function score(value, denominator) { return `${value === null || !hasValue(value) ? '—' : value} / ${denominator}`; }

  /** Split oversized table rows across pages with repeated column headings. */
  function table(headers, rows, ratios, { size = 9 } = {}) {
    const widths = ratios.map((ratio) => WIDTH * ratio);
    const padding = 7;
    const leading = size * 1.65;
    const headerCells = headers.map((value, index) => wrap(value, widths[index] - padding * 2, size, true));
    const headerHeight = Math.max(...headerCells.map((cell) => cell.length)) * leading + padding * 2;
    const wrappedRows = rows.map((row) => row.map((value, column) => wrap(text(value), widths[column] - padding * 2, size)));
    const firstRowHeight = wrappedRows.length ? Math.max(...wrappedRows[0].map((cell) => cell.length)) * leading + padding * 2 : 0;
    // Do not leave an empty table header at the bottom of the previous page.
    ensure(headerHeight + Math.min(firstRowHeight, BOTTOM - contentTop - headerHeight));
    function drawCells(cells, height, header, stripe) {
      let x = LEFT;
      for (let index = 0; index < cells.length; index++) {
        doc.rect(x, y, widths[index], height).fillAndStroke(header ? COLORS.teal : stripe ? COLORS.pale : '#FFFFFF', COLORS.border);
        cells[index].forEach((value, row) => line(value, x + padding, y + padding + row * leading, widths[index] - padding * 2, size, header, header ? '#FFFFFF' : COLORS.ink));
        x += widths[index];
      }
      y += height;
    }
    function header() {
      ensure(headerHeight + leading + padding * 2);
      drawCells(headerCells, headerHeight, true, false);
    }
    header();
    wrappedRows.forEach((cells, index) => {
      const totalLines = Math.max(...cells.map((cell) => cell.length));
      let offset = 0;
      const fullHeight = totalLines * leading + padding * 2;
      // Keep a normal row together, but don't try to keep a page-sized row whole.
      if (y + fullHeight > BOTTOM && fullHeight + headerHeight <= BOTTOM - contentTop) { newPage(); header(); }
      while (offset < totalLines) {
        const capacity = Math.floor((BOTTOM - y - padding * 2) / leading);
        if (capacity < 1) { newPage(); header(); continue; }
        const count = Math.min(capacity, totalLines - offset);
        drawCells(cells.map((cell) => cell.slice(offset, offset + count)), count * leading + padding * 2, false, index % 2 === 0);
        offset += count;
        if (offset < totalLines) { newPage(); header(); }
      }
    });
    gap(12);
  }

  newPage(true);
  paragraph(model.fictionalSample ? `FICTIONAL SAMPLE\n${model.title}` : model.title, { size: 20, bold: true, color: COLORS.teal, after: 18 });
  if (model.fictionalSample) paragraph('All names, identifiers, dates, scores and comments in this example are fictional. Not an actual employee review.', { size: 9, color: COLORS.muted, after: 14 });
  const h = model.header;
  const headerPrefix = model.fictionalSample ? 'FICTIONAL SAMPLE — ' : '';
  table(['Field', 'Recorded information'], [
    ['Employee Name:', h.employeeName], ['Role/Title:', h.roleTitle], ['Department:', h.department],
    ['Manager:', h.manager], ['Review Period:', h.reviewPeriod], ['Date of Review:', h.reviewDate],
    ['Employee Slack ID:', h.employeeSlackId], ['Manager Slack ID:', h.managerSlackId], ['Opened at (system record):', h.openedAt],
  ].map(([label, value]) => [headerPrefix + label, value]), [0.37, 0.63]);
  heading('Introduction');
  paragraph(model.introduction);

  const [p1, p2, p3, p4, p5, p6, p7, p8, p9] = model.parts;
  ensure(240);
  heading(p1.title, true);
  heading('OKR Achievement Summary');
  paragraph(`Saved objectives owner: ${p1.objectivesOwner === 'employee' ? 'Employee self-report' : 'Manager'}.`, { size: 8, color: COLORS.muted });
  table(['Objective', 'Key Results', 'Target', 'Actual', 'Score (0-1.0)'],
    p1.objectives.length ? p1.objectives.map((objective, index) => [`Objective ${index + 1}: ${objective.title}`, objective.keyResults, objective.target, objective.actual, objective.score ?? '—'])
      : [[NOT_RECORDED, NOT_RECORDED, '—', '—', '—']], [0.25, 0.27, 0.16, 0.16, 0.16]);
  paragraph(`Average OKR Score: ${score(p1.averageOkr, '1.0')}`, { bold: true });
  heading('Manager Commentary on Results');
  paragraph(p1.commentaryPrompt, { size: 9, color: COLORS.muted });
  paragraph(p1.resultsCommentary, { indent: 8 });

  heading(p2.title, true);
  paragraph(p2.instruction);
  table(['Rating', 'Description'], p2.scale.map((rating) => [rating.score, rating.description]), [0.12, 0.88]);
  for (const value of p2.values) {
    ensure(145);
    heading(value.label);
    paragraph(value.description, { size: 9 });
    paragraph(`Self-Rating: ${score(value.selfScore, '5')}     •     Manager Rating: ${score(value.managerScore, '5')}`, { bold: true });
    field('Observations & Examples:', value.observation);
  }
  paragraph(`Average Values Score: ${score(p2.averageValues, '5')}`, { bold: true });

  heading(p3.title, true);
  paragraph(p3.instruction);
  table(['Project Name', 'Role', 'Key Contributions', 'Client Feedback', 'Rating (1-5)'], [[p3.project.name, p3.project.role, p3.project.contribution, p3.project.clientFeedback, p3.project.score ?? '—']], [0.2, 0.16, 0.27, 0.23, 0.14]);
  paragraph(`Average Project Score: ${score(p3.project.averageScore, '5')}`, { bold: true });

  heading(p4.title, true);
  paragraph(p4.instruction);
  field('Strengths Identified by Peers', p4.strengths);
  field('Areas for Growth Identified by Peers', p4.areasForGrowth);
  paragraph(`360 Feedback Score: ${score(p4.score, '5')}`, { size: 9 });

  heading(p5.title, true);
  for (const reflection of p5.reflections) field(reflection.question, reflection.response);

  heading(p6.title, true);
  heading('Performance Rating Calculation');
  table(['Component', 'Weight', 'Score', 'Weighted Score'], [
    ...p6.components.map((component) => [component.label, `${component.weight}%`, score(component.score, component.scale), '—']),
    ['Overall Score', '—', '—', score(p6.overallScore, '5')],
  ], [0.36, 0.14, 0.22, 0.28]);
  paragraph(p6.weightedScoreNote, { size: 8, color: COLORS.muted });
  heading('Overall Performance Rating');
  table(['Select', 'Rating', 'Description'], p6.ratingDefinitions.map((rating) => [rating.selected ? '[X]' : '[ ]', rating.label, rating.description]), [0.1, 0.32, 0.58]);
  paragraph(`Recorded Overall Performance Rating: ${p6.overallRating ?? NOT_RECORDED}`, { size: 9, bold: true });
  field('Manager Rationale for Overall Rating', p6.managerRationale);
  heading('"Keeper" Assessment');
  paragraph(p6.keeperPrompt);
  table(['Select', 'Assessment', 'Rationale'], p6.keeperOptions.map((option) => [option.selected ? '[X]' : '[ ]', option.label, option.selected ? p6.keeperRationale : '—']), [0.1, 0.59, 0.31]);
  paragraph(`Recorded "Keeper" Assessment: ${p6.keeperAssessment}`, { size: 9, bold: true });
  // Preserve the rationale even if a historical assessment has no recognized selection.
  if (!p6.keeperOptions.some((option) => option.selected)) field('Keeper Rationale', p6.keeperRationale);

  heading(p7.title, true);
  heading('Career Aspirations');
  field('Short-term (Next 12 months):', p7.careerShortTerm);
  field('Long-term (Next 3-5 years):', p7.careerLongTerm);
  heading('Actionable Development Goals');
  table(['#', 'Skill/Area to Improve', 'Action Steps', 'Timeline', 'ClickUp Task ID'],
    (p7.developmentGoals.length ? p7.developmentGoals : Array.from({ length: 3 }, () => ({ skill: NOT_RECORDED, actionSteps: '—', timeline: '—', clickUpTaskId: '—' })))
      .map((goal, index) => [index + 1, goal.skill, goal.actionSteps, goal.timeline, goal.clickUpTaskId]), [0.06, 0.26, 0.32, 0.18, 0.18]);

  heading(p8.title, true);
  paragraph(p8.instruction, { size: 9, color: COLORS.muted });
  paragraph(p8.coreMessage, { indent: 8 });
  // Keep the approved blank hard-copy blocks, typed-record note and a useful
  // amount of comments space together; long recorded comments may still flow.
  ensure(430);
  heading(p9.title, true);
  for (const signature of p9.hardCopyLines) {
    heading(signature.label);
    paragraph(signature.signature, { after: 8 });
    paragraph(signature.date, { after: 22 });
  }
  const sr = p9.systemRecord;
  paragraph('System record (typed entries; not handwritten signatures):', { size: 8, bold: true, color: COLORS.muted, after: 4 });
  paragraph('Printing or signing this copy does not change the electronic review status shown in the header.', { size: 8, color: COLORS.muted, after: 4 });
  paragraph(`Manager typed name: ${sr.managerSignature}\nManager recorded review date: ${sr.reviewDate}\nEmployee typed name: ${sr.employeeSignature}\nEmployee recorded signature date: ${sr.employeeSignatureDate}`, { size: 8, color: COLORS.muted });
  heading('Employee Comments (Optional)');
  paragraph(p9.commentsPrompt, { size: 9, color: COLORS.muted });
  paragraph(p9.employeeComments, { indent: 8 });

  const pages = doc.bufferedPageRange();
  for (let page = pages.start; page < pages.start + pages.count; page++) {
    doc.switchToPage(page);
    const footerY = doc.page.height - 54;
    doc.moveTo(LEFT, footerY - 8).lineTo(LEFT + WIDTH, footerY - 8).strokeColor(COLORS.border).lineWidth(0.7).stroke();
    wrap(model.footer, WIDTH - 75, 7).forEach((value, index) => line(value, LEFT, footerY + index * 11, WIDTH - 75, 7, false, COLORS.muted));
    line(`${page + 1} / ${pages.count}`, LEFT + WIDTH - 58, footerY, 58, 8, false, COLORS.muted);
  }
}

/** Generate the whole PDF in memory. No filesystem writes, uploads or URLs. */
async function generateAnnualReviewPdf(review, options = {}) {
  const model = buildAnnualReviewPrintModel(review, options);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', bufferPages: true, margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `${model.fictionalSample ? 'FICTIONAL SAMPLE — ' : ''}${model.title}`,
        Author: 'Saudi HTC', Subject: `${model.header.classification} — ${model.header.caseId}`,
      },
    });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      for (const [name, file] of Object.entries(FONT_FILES)) doc.registerFont(name, path.join(FONT_DIR, file));
      createRenderer(doc, model);
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error);
    }
  });
}

module.exports = { buildAnnualReviewPrintModel, generateAnnualReviewPdf };
