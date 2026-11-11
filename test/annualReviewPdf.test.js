'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { generateAnnualReviewPdf, buildAnnualReviewPrintModel } = require('../src/utils/annualReviewPdf');
const {
  SAUDI_HTC_VALUES, VALUE_SCORE_LABELS, OVERALL_RATING_LABELS, KEEPER_OPTIONS,
} = require('../src/utils/saudiHtcPerformance');

const values = (score) => Object.fromEntries(SAUDI_HTC_VALUES.map(({ key }) => [key, score]));
const normalize = (value) => value.replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
const part = (model, number) => model.parts[number - 1];

// This fixture is entirely synthetic. It does not read sheets, Slack or any
// employee records; even names, identifiers and task IDs are explicitly samples.
function fictionalReview() {
  return {
    caseId: 'FICTIONAL-SAMPLE-ANNUAL-001', status: 'FICTIONAL SAMPLE — Completed',
    employeeName: 'FICTIONAL SAMPLE — Amélie Example / مريم مثال',
    employeeSlackId: 'FICTIONAL-EMPLOYEE-ID', managerSlackId: 'FICTIONAL-MANAGER-ID',
    reviewPeriod: 'FICTIONAL SAMPLE — 1 January–31 December 2026', openedAt: 'FICTIONAL SAMPLE — 2026-01-08T09:00:00Z',
    employeeScores: {
      values: { buildFuture: 4, carefulBold: 3, clearReal: 4, excellent: 4, worldClassTalent: 3 },
      objectives: [
        { title: 'Improve a fictional service workflow', keyResults: 'KR 1.1: Document the baseline.\nKR 1.2: Pilot a checklist.', target: '90% checklist adoption', actual: '92% in the fictional pilot', score: 1 },
        { title: 'Share fictional process knowledge', keyResults: 'KR 2.1: Publish a sample guide.\nKR 2.2: Run two practice workshops.', target: '2 practice workshops', actual: '2 workshops; sample guide issued', score: 0.75 },
        { title: 'Develop a fictional dashboard', keyResults: 'KR 3.1: Agree sample metrics.\nKR 3.2: Review the prototype.', target: '1 reviewed prototype', actual: 'Prototype reviewed; final iteration deferred', score: 0.5 },
      ],
      reflections: {
        accomplishment: 'FICTIONAL SAMPLE: I am proud of making a sample workflow easier for the practice team. It demonstrated Be Clear Be Real through transparent status reporting and Build World Class Talent through shared learning.\nمثال خيالي: التعاون والتعلم المستمر.',
        challenge: 'FICTIONAL SAMPLE: Priorities changed during the practice pilot. I learned to document trade-offs early and ask for a decision before committing additional effort.',
        support: 'FICTIONAL SAMPLE: Protected learning time, access to sample analytics tools, and regular coaching would help me be more effective next year.',
      },
    },
    managerScores: {
      values: { buildFuture: 4, carefulBold: 4, clearReal: 3, excellent: 4, worldClassTalent: 5 },
      valueObservations: {
        buildFuture: 'FICTIONAL SAMPLE: Proposed a useful prototype and connected it to the practice team’s longer-term service goals.',
        carefulBold: 'FICTIONAL SAMPLE: Used sample data to compare options, documented risk, and proposed a small reversible pilot.',
        clearReal: 'FICTIONAL SAMPLE: Shared progress honestly. Further practice is needed in escalating dependency changes earlier.',
        excellent: 'FICTIONAL SAMPLE: Produced reliable sample documentation and used peer review to improve quality.',
        worldClassTalent: 'FICTIONAL SAMPLE: Organized two practice workshops and supported new fictional colleagues with reusable guides.',
      },
      // A different manager objective proves the persisted owner is respected.
      objectives: [{ title: 'UNSELECTED MANAGER OBJECTIVE', score: 1 }],
      resultsCommentary: 'OLDER FICTIONAL COMMENTARY — final discussion supersedes this.',
      finalAssessment: {
        objectivesOwner: 'employee',
        resultsCommentary: 'FICTIONAL SAMPLE: The employee focused on the agreed priorities, adapted the sample pilot when dependencies changed, and made useful practice-team improvements. The recorded OKR average reflects the selected saved employee objectives; these results are not a real performance appraisal.',
        project: { name: 'FICTIONAL SAMPLE — Practice service pilot', role: 'Sample workstream contributor', contribution: 'Documented the sample process, coordinated practice reviews, and delivered a reviewed prototype.', clientFeedback: 'FICTIONAL SAMPLE: Practice stakeholders valued clear follow-up and requested earlier dependency updates.', score: 4, averageScore: '4.0' },
        feedback360: { score: 4, strengths: '1. FICTIONAL SAMPLE: Collaboration.\n2. FICTIONAL SAMPLE: Reliable follow-up.\n3. FICTIONAL SAMPLE: Knowledge sharing.', areasForGrowth: '1. FICTIONAL SAMPLE: Earlier escalation.\n2. FICTIONAL SAMPLE: Delegation.\n3. FICTIONAL SAMPLE: Concise executive updates.' },
        // Intentionally recorded as an entry, NOT a formula result.
        overallScore: '4.1', overallRating: 4,
        managerRationale: 'FICTIONAL SAMPLE: The recorded rating reflects the manager’s sample assessment of delivery, behavior and growth. No weighted component calculation was captured in this example.',
        keeperAssessment: 'Valuable Contributor', keeperRationale: 'FICTIONAL SAMPLE: A dependable practice-team contributor; continued development in delegation would strengthen readiness for greater responsibility.',
        careerShortTerm: 'FICTIONAL SAMPLE: Lead a small practice workstream and improve concise stakeholder communication.',
        careerLongTerm: 'FICTIONAL SAMPLE: Develop toward a fictional service-improvement leadership role over the next 3–5 years.',
        developmentGoals: [
          { skill: 'Stakeholder communication', actionSteps: 'Draft a one-page practice update monthly; ask a fictional mentor to review clarity and escalation decisions.', timeline: 'FICTIONAL SAMPLE — Q1 2027', clickUpTaskId: 'FICTIONAL-TASK-001' },
          { skill: 'Delegation', actionSteps: 'Assign two sample tasks with clear outcomes and hold short follow-up reviews.', timeline: 'FICTIONAL SAMPLE — Q2 2027', clickUpTaskId: 'FICTIONAL-TASK-002' },
          { skill: 'Data storytelling', actionSteps: 'Complete a practice course and present a sample dashboard narrative.', timeline: 'FICTIONAL SAMPLE — Q3 2027', clickUpTaskId: 'FICTIONAL-TASK-003' },
        ],
        coreMessage: 'FICTIONAL SAMPLE: A strong practice-year contributor with a focus on early escalation, delegation and clear stakeholder communication.',
        managerSignature: 'FICTIONAL SAMPLE — Morgan Example', reviewDate: 'FICTIONAL SAMPLE — 10 January 2027',
        employeeSignature: 'FICTIONAL SAMPLE — Amélie Example', employeeSignatureDate: 'FICTIONAL SAMPLE — 11 January 2027',
        employeeComments: 'FICTIONAL SAMPLE: I appreciate the feedback and will use the practice goals as a learning plan. These typed names are system-record entries, not handwritten signatures.',
      },
    },
  };
}

function run(command, args, input) {
  const result = spawnSync(command, args, { input, maxBuffer: 32 * 1024 * 1024, timeout: 120000 });
  assert.ifError(result.error); // Poppler is required for these real PDF tests.
  assert.equal(result.status, 0, `${command}: ${result.stderr?.toString()}`);
  return result.stdout;
}
// Raw reading order keeps each rendered cell contiguous. Layout extraction can
// interleave other columns between lines of a long cell (not a content loss).
const extract = (buffer) => run('pdftotext', ['-raw', '-', '-'], buffer).toString('utf8');

// The public functions have no disk/output/network parameters. Parsing and
// rendering below happens via stdin/stdout; only the opt-in fictional sample
// test writes the specifically requested demonstration file.
test('model preserves approved Parts 1–9, all 5Bs descriptions and rating definitions', () => {
  const review = fictionalReview();
  const before = JSON.stringify(review);
  const model = buildAnnualReviewPrintModel(review, { employee: { jobTitle: 'FICTIONAL SAMPLE — Analyst', department: 'FICTIONAL SAMPLE — Operations' }, managerName: 'FICTIONAL SAMPLE — Morgan Example' });
  assert.equal(model.parts.length, 9);
  model.parts.forEach((section, index) => assert.equal(section.number, index + 1));
  assert.equal(model.introduction, 'This review evaluates your performance across three dimensions: Results (what you achieved), Values (how you achieved it), and Growth (your development journey). The process is designed to foster continuous improvement, strategic alignment, and open communication.');
  assert.equal(model.footer, 'This form is part of the Saudi HTC Performance & Growth Framework. For questions or support, contact HR.');
  for (const [index, value] of SAUDI_HTC_VALUES.entries()) {
    assert.equal(part(model, 2).values[index].description, value.description);
    assert.equal(part(model, 2).values[index].selfScore, review.employeeScores.values[value.key]);
    assert.equal(part(model, 2).values[index].managerScore, review.managerScores.values[value.key]);
    assert.equal(part(model, 2).values[index].observation, review.managerScores.valueObservations[value.key]);
  }
  for (const scale of part(model, 2).scale) assert.equal(scale.description, VALUE_SCORE_LABELS[scale.score]);
  for (const rating of part(model, 6).ratingDefinitions) assert.equal(`${rating.label.split(' - ').slice(1).join(' - ')} - ${rating.description}`, OVERALL_RATING_LABELS[rating.rating]);
  assert.deepEqual(part(model, 6).keeperOptions.map(({ value, label }) => ({ value, label })), KEEPER_OPTIONS);
  assert.equal(part(model, 5).reflections.length, 3);
  for (const reflection of part(model, 5).reflections) assert.equal(reflection.response, review.employeeScores.reflections[reflection.key]);
  assert.equal(JSON.stringify(review), before);
});

test('historical objectives use persisted owner, otherwise saved employee objective presence only', () => {
  const review = fictionalReview();
  let model = buildAnnualReviewPrintModel(review, { objectivesOwner: 'manager' });
  assert.equal(part(model, 1).objectivesOwner, 'employee');
  assert.equal(part(model, 1).objectives.length, 3);
  assert.equal(part(model, 1).resultsCommentary, review.managerScores.finalAssessment.resultsCommentary);
  review.managerScores.finalAssessment.objectivesOwner = 'manager';
  model = buildAnnualReviewPrintModel(review, { objectivesOwner: 'employee' });
  assert.equal(part(model, 1).objectives[0].title, 'UNSELECTED MANAGER OBJECTIVE');
  review.managerScores.finalAssessment.objectivesOwner = 'invalid';
  assert.equal(part(buildAnnualReviewPrintModel(review), 1).objectivesOwner, 'employee');
  delete review.managerScores.finalAssessment.objectivesOwner;
  review.objectivesOwner = 'manager'; // Not a historical final-assessment owner.
  assert.equal(part(buildAnnualReviewPrintModel(review), 1).objectivesOwner, 'employee');
  review.employeeScores.objectives = [];
  assert.equal(part(buildAnnualReviewPrintModel(review), 1).objectivesOwner, 'manager');
  delete review.managerScores.finalAssessment.resultsCommentary;
  assert.equal(part(buildAnnualReviewPrintModel(review), 1).resultsCommentary, review.managerScores.resultsCommentary);
  review.managerScores.finalAssessment.objectivesOwner = 'employee';
  assert.deepEqual(part(buildAnnualReviewPrintModel(review), 1).objectives, []); // No fallback to other owner's objectives.
});

test('only approved averages are derived; no reweighting, conversion, overall recalculation or rating assignment', () => {
  const review = fictionalReview();
  const model = buildAnnualReviewPrintModel(review);
  assert.equal(part(model, 1).averageOkr, 0.75);
  assert.equal(part(model, 2).averageValues, 4);
  const assessment = part(model, 6);
  assert.deepEqual(assessment.components.map(({ weight }) => weight), [40, 30, 20, 10]);
  assert.deepEqual(assessment.components.map(({ score }) => score), [0.75, 4, '4.0', 4]);
  assert.ok(assessment.components.every(({ weightedScore }) => weightedScore === null));
  assert.equal(assessment.overallScore, '4.1');
  assert.equal(assessment.overallRating, 4);
  assert.deepEqual(assessment.ratingDefinitions.filter(({ selected }) => selected).map(({ rating }) => rating), [4]);
  review.managerScores.finalAssessment = { project: { score: 5 }, feedback360: { score: 5 } };
  const missing = part(buildAnnualReviewPrintModel(review), 6);
  assert.equal(missing.overallScore, null);
  assert.equal(missing.overallRating, null);
  assert.equal(missing.components[2].score, null); // Project score does not invent averageScore.
  assert.ok(missing.ratingDefinitions.every(({ selected }) => !selected));
});

test('missing values are explicit and recorded zero never becomes absent or a fabricated average', () => {
  const missing = buildAnnualReviewPrintModel({});
  assert.equal(missing.header.employeeName, 'Not recorded');
  assert.equal(part(missing, 1).averageOkr, null);
  assert.equal(part(missing, 2).averageValues, null);
  assert.ok(part(missing, 2).values.every(({ selfScore, managerScore, observation }) => selfScore === null && managerScore === null && observation === 'Not recorded'));
  assert.ok(part(missing, 5).reflections.every(({ response }) => response === 'Not recorded'));
  const review = { employeeScores: { objectives: [{ score: 0 }] }, managerScores: { values: values(4), finalAssessment: { overallScore: 0 } } };
  assert.equal(part(buildAnnualReviewPrintModel(review), 1).averageOkr, 0);
  assert.equal(part(buildAnnualReviewPrintModel(review), 6).overallScore, 0);
  for (const score of [null, undefined, '', ' ', 'invalid', 2, -1]) {
    review.employeeScores.objectives[0].score = score;
    assert.equal(part(buildAnnualReviewPrintModel(review), 1).averageOkr, null);
  }
  review.managerScores.values.buildFuture = 'invalid';
  assert.equal(part(buildAnnualReviewPrintModel(review), 2).averageValues, null);
  assert.doesNotThrow(() => buildAnnualReviewPrintModel(null, { employee: null }));
});

test('approved hard-copy signature/date lines stay exactly blank, with typed data separate', () => {
  const model = buildAnnualReviewPrintModel(fictionalReview());
  assert.deepEqual(part(model, 9).hardCopyLines, [
    { label: 'Manager', signature: 'Signature: ___________________', date: 'Date: ___________________' },
    { label: 'Employee', signature: 'Signature: ___________________', date: 'Date: ___________________' },
  ]);
  assert.equal(part(model, 9).systemRecord.managerSignature, 'FICTIONAL SAMPLE — Morgan Example');
  assert.equal(part(model, 9).systemRecord.employeeSignatureDate, 'FICTIONAL SAMPLE — 11 January 2027');
});

test('packaged Latin/Arabic regular/bold fonts and OFL license ship with app', () => {
  const dir = path.join(__dirname, '../assets/fonts');
  for (const name of ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf', 'NotoSansArabic-Regular.ttf', 'NotoSansArabic-Bold.ttf']) {
    const content = fs.readFileSync(path.join(dir, name));
    assert.ok(content.length > 100000);
    assert.equal(content.readUInt32BE(0), 0x00010000);
  }
  const license = fs.readFileSync(path.join(dir, 'NOTO-LICENSE.txt'), 'utf8');
  assert.match(license, /Google/);
  assert.match(license, /SIL Open Font License/);
  assert.match(license, /PERMISSION & CONDITIONS/);
});

test('actual PDFKit runtime produces parseable A4 with every approved section, scores and Unicode', async () => {
  const review = fictionalReview();
  const buffer = await generateAnnualReviewPdf(review, { employee: { jobTitle: 'Sample Analyst', department: 'Sample Operations' }, managerName: 'Sample Manager', fictionalSample: true });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  const info = run('pdfinfo', ['-'], buffer).toString();
  assert.match(info, /A4/);
  assert.match(info, /FICTIONAL SAMPLE/);
  const raw = extract(buffer);
  const output = normalize(raw);
  for (const section of buildAnnualReviewPrintModel(review).parts) assert.ok(output.includes(section.title), section.title);
  for (const value of SAUDI_HTC_VALUES) {
    assert.ok(output.includes(value.label), value.label);
    assert.ok(output.includes(value.description), value.description);
    assert.ok(output.includes(review.managerScores.valueObservations[value.key]));
  }
  for (const definition of Object.values(VALUE_SCORE_LABELS)) assert.ok(output.includes(definition), definition);
  for (const definition of Object.values(OVERALL_RATING_LABELS)) assert.ok(output.includes(definition.split(' - ').slice(1).join(' - ')), definition);
  for (const option of KEEPER_OPTIONS) assert.ok(output.includes(option.label), option.label);
  assert.ok(output.includes('Average OKR Score: 0.75 / 1.0'));
  assert.ok(output.includes('Average Values Score: 4 / 5'));
  assert.ok(output.includes('4.1 / 5'));
  assert.ok(output.includes('Recorded Overall Performance Rating: 4'));
  assert.equal((output.match(/Signature: ___________________/g) || []).length, 2);
  assert.equal((output.match(/Date: ___________________/g) || []).length, 2);
  assert.ok(output.includes('System record (typed entries; not handwritten signatures):'));
  assert.ok(output.includes('Printing or signing this copy does not change the electronic review status shown in the header.'));
  assert.ok(output.includes('Manager typed name: FICTIONAL SAMPLE — Morgan Example'));
  assert.ok(output.includes('Employee recorded signature date: FICTIONAL SAMPLE — 11 January 2027'));
  assert.ok(output.includes('Amélie'));
  assert.match(raw, /[\u0600-\u06ff]/u); // Arabic has Unicode mappings, not missing-glyph squares.
  assert.doesNotMatch(raw, /\uFFFD|\u0000/);
  assert.doesNotMatch(output, /UNSELECTED MANAGER OBJECTIVE|OLDER FICTIONAL COMMENTARY/);
  const pages = raw.split('\f').filter((page) => page.trim());
  assert.ok(pages.length >= 4);
  for (const page of pages) {
    assert.match(page, /FICTIONAL SAMPLE \| CONFIDENTIAL/);
    assert.ok(normalize(page).includes('Case: FICTIONAL-SAMPLE-ANNUAL-001'));
    assert.ok(normalize(page).includes(buildAnnualReviewPrintModel({}).footer));
  }
});

test('oversized table rows and long paragraphs paginate without truncating any saved fields', async () => {
  const review = fictionalReview();
  const long = 'A lengthy fictional paragraph preserves all recorded evidence and continues over the page boundary. '.repeat(130);
  review.employeeScores.objectives[0].keyResults = `OBJECTIVE_START ${long} OBJECTIVE_END`;
  review.managerScores.finalAssessment.project.clientFeedback = `CLIENT_START ${long} CLIENT_END`;
  review.managerScores.finalAssessment.resultsCommentary = `COMMENTARY_START ${long} COMMENTARY_END`;
  review.managerScores.valueObservations.buildFuture = `OBSERVATION_START ${long} OBSERVATION_END`;
  review.employeeScores.reflections.support = `SUPPORT_START ${long} SUPPORT_END`;
  review.managerScores.finalAssessment.developmentGoals[0].actionSteps = `GOAL_START ${long} GOAL_END`;
  review.managerScores.finalAssessment.employeeComments = `COMMENTS_START ${long} COMMENTS_END`;
  review.managerScores.finalAssessment.developmentGoals.push({ skill: 'Fourth saved goal', actionSteps: 'FOURTH_GOAL_PRESERVED', timeline: 'Q4', clickUpTaskId: 'SAMPLE-FOUR' });
  const buffer = await generateAnnualReviewPdf(review);
  const raw = extract(buffer);
  const output = normalize(raw);
  for (const field of ['OBJECTIVE', 'CLIENT', 'COMMENTARY', 'OBSERVATION', 'SUPPORT', 'GOAL', 'COMMENTS']) {
    assert.ok(output.includes(`${field}_START`), `${field} start`);
    assert.ok(output.includes(`${field}_END`), `${field} end`);
  }
  assert.ok(output.includes('FOURTH_GOAL_PRESERVED'));
  assert.ok(raw.split('\f').length > 12);
  // A page split inserts repeated headings/footer and remaining cells between
  // sentence fragments in Poppler's reading order. Independently count each
  // distinctive word: all seven fields retain all 130 repetitions, not merely
  // their start/end markers. None of these words occur in fixture metadata.
  for (const word of ['lengthy', 'paragraph', 'preserves', 'evidence', 'continues', 'boundary']) {
    assert.equal((output.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length, 130 * 7, word);
  }
});

test('unbroken Unicode text, newlines and an entirely missing record render through real PDF runtime', async () => {
  const review = { employeeScores: { reflections: { accomplishment: 'Ångström — café / مريم مثال\n' + 'UNBROKEN'.repeat(180) + '\nUNICODE_END' } } };
  const buffer = await generateAnnualReviewPdf(review);
  const output = normalize(extract(buffer));
  assert.ok(output.includes('Ångström — café'));
  assert.ok(output.includes('UNICODE_END'));
  assert.ok(output.includes('Not recorded'));
  assert.ok(output.includes('Part 9: Signatures'));
  assert.doesNotMatch(output, /NaN|undefined|null/);
  const png = run('pdftoppm', ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '400', '-png'], buffer);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(png.length > 5000);
  const blank = normalize(extract(await generateAnnualReviewPdf({})));
  for (let n = 1; n <= 9; n++) assert.ok(blank.includes(`Part ${n}:`));
  assert.ok(blank.includes('Average OKR Score: — / 1.0'));
  assert.ok(blank.includes('Average Values Score: — / 5'));
  assert.ok(blank.includes('Recorded Overall Performance Rating: Not recorded'));
});

test('awaiting-signature and completed exports preserve electronic status and recorded zero scores', async () => {
  for (const status of ['Awaiting Employee Signature', 'Completed']) {
    const review = {
      caseId: 'FICTIONAL-STATUS-TEST', status, employeeName: 'Fictional Example',
      employeeScores: { objectives: [{ title: 'Fictional objective', score: 0 }] },
      managerScores: { finalAssessment: { overallScore: 0, managerSignature: 'Fictional Manager', reviewDate: 'Fictional date' } },
    };
    const before = JSON.stringify(review);
    const output = normalize(extract(await generateAnnualReviewPdf(review)));
    assert.equal(JSON.stringify(review), before);
    assert.ok(output.includes(`Status: ${status}`));
    assert.ok(output.includes('Average OKR Score: 0 / 1.0'));
    assert.ok(output.includes('0 / 5'));
    assert.ok(output.includes('Employee typed name: Not recorded'));
    assert.equal((output.match(/Signature: ___________________/g) || []).length, 2);
    assert.equal((output.match(/Date: ___________________/g) || []).length, 2);
    assert.ok(output.includes('Printing or signing this copy does not change the electronic review status shown in the header.'));
  }
});

// Run explicitly with GENERATE_ANNUAL_REVIEW_SAMPLE=1 to regenerate the requested
// sample. Normal application generation remains Buffer-only and never saves it.
if (process.env.GENERATE_ANNUAL_REVIEW_SAMPLE === '1') {
  test('write the explicitly fictional demonstration PDF', async () => {
    const buffer = await generateAnnualReviewPdf(fictionalReview(), {
      employee: { jobTitle: 'FICTIONAL SAMPLE — Service Improvement Analyst', department: 'FICTIONAL SAMPLE — Operations' },
      managerName: 'FICTIONAL SAMPLE — Morgan Example', fictionalSample: true,
    });
    fs.writeFileSync('/home/ubuntu/Annual_Review_Print_Example.pdf', buffer);
    assert.ok(normalize(extract(buffer)).includes('All names, identifiers, dates, scores and comments in this example are fictional.'));
  });
}
