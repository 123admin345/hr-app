const test = require('node:test');
const assert = require('node:assert/strict');
const {
  registerAnnualReviewExportHandlers, canPrintAnnualReview, printableAnnualReviews,
  printFilename, printSelectionModal, loadingPrintModal, printErrorMessage,
} = require('../src/handlers/annualReviewExportHandler');

function review(overrides = {}) {
  return { caseId: 'PERF-PRINT-001', reviewType: 'Annual', status: 'Completed', openedAt: '2026-10-29',
    employeeName: 'Example Employee', employeeSlackId: 'UEMPLOYEE', managerSlackId: 'UMANAGER', reviewPeriod: '2026',
    managerScores: { finalAssessment: { managerSignature: 'Example Manager', employeeSignature: 'Example Employee', overallRating: 4 } }, ...overrides };
}

function harness({ isHr = (id) => id === 'UHR', cases = [review()], generatePdf, uploadError } = {}) {
  const events = [], handlers = {}, writes = [], logs = [];
  const app = { command: (id, fn) => { handlers[id] = fn; }, action: (id, fn) => { handlers[id] = fn; }, view: (id, fn) => { handlers[id] = fn; } };
  const client = {
    chat: { postMessage: async (payload) => { events.push(['message', payload]); return { ok: true }; } },
    views: { open: async (payload) => { events.push(['open', payload]); return { view: { id: 'VPRINT', hash: 'HASH' } }; }, update: async (payload) => { events.push(['update', payload]); return { ok: true }; } },
    conversations: { open: async (payload) => { events.push(['dm', payload]); return { channel: { id: 'DHRPRIVATE' } }; } },
    filesUploadV2: async (payload) => { events.push(['upload', payload]); if (uploadError) throw uploadError; return { ok: true, files: [{ id: 'FPRIVATEPDF' }] }; },
  };
  const sheets = {
    getAllPerformanceReviews: async () => { events.push(['read_reviews']); return cases; },
    getPerformanceReviewCase: async (id) => { events.push(['read_case', id]); return cases.find((r) => r.caseId === id) || null; },
    getAllEmployees: async () => { events.push(['read_profiles']); return [{ slackUserId: 'UEMPLOYEE', name: 'Example Employee', jobTitle: 'Analyst', department: 'Operations' }, { slackUserId: 'UMANAGER', name: 'Example Manager' }]; },
    updatePerformanceReviewCase: async (...args) => writes.push(args), appendPerformanceReviewAudit: async (...args) => writes.push(args),
  };
  registerAnnualReviewExportHandlers(app, { isHr, sheets, generatePdf: generatePdf || (async (r, opts) => { events.push(['pdf', r.caseId, opts]); return Buffer.from('%PDF-1.7\nTEST'); }) });
  const logger = { error: (...args) => logs.push(args) };
  const ack = async (payload) => { events.push(['ack', payload]); };
  return { client, events, handlers, writes, logs, logger, ack };
}

test('prints only annual reviews with a submitted final manager signature', () => {
  assert.equal(canPrintAnnualReview(review()), true);
  assert.equal(canPrintAnnualReview(review({ status: 'Awaiting Employee Signature' })), true);
  for (const status of ['Initial Review Open', 'Discussion Open', 'Awaiting Manager Outcome']) assert.equal(canPrintAnnualReview(review({ status })), false);
  assert.equal(canPrintAnnualReview(review({ reviewType: 'Contract Renewal' })), false);
  assert.equal(canPrintAnnualReview(review({ managerScores: {} })), false);
  assert.deepEqual(printableAnnualReviews([review({ openedAt: '2025-01-01', caseId: 'PERF-OLD' }), review()]).map((r) => r.caseId), ['PERF-PRINT-001', 'PERF-OLD']);
});

test('uses safe filenames and valid Slack print modal lengths', () => {
  const menu = printSelectionModal([review({ employeeName: 'A'.repeat(120), reviewPeriod: 'P'.repeat(100) })], 'UHR');
  assert.ok(menu.title.text.length <= 24);
  assert.ok(loadingPrintModal().title.text.length <= 24);
  assert.ok(menu.blocks.find((b) => b.type === 'input').element.options.every((o) => o.text.text.length <= 75));
  assert.equal(menu.callback_id, 'annual_review_pdf_submit');
  assert.equal(printSelectionModal([], 'UHR').submit, undefined);
  assert.doesNotMatch(printFilename(review({ caseId: '../../bad/secret' })), /\.\.|\//);
});

test('rejects non-HR users before reading any review or producing any PDF', async () => {
  const h = harness();
  await h.handlers['/download-annual-review']({ command: { user_id: 'UMANAGER', text: 'PERF-PRINT-001' }, ack: h.ack, client: h.client, logger: h.logger });
  assert.equal(h.events[0][0], 'ack');
  assert.equal(h.events.filter((e) => e[0] === 'read_case' || e[0] === 'read_reviews' || e[0] === 'upload').length, 0);
  assert.match(h.events.find((e) => e[0] === 'message')[1].text, /Only authorised HR/);
});

test('opens a loading print modal before Google Sheets is read', async () => {
  const h = harness();
  await h.handlers['/download-annual-review']({ command: { user_id: 'UHR', trigger_id: 'FRESH', text: '' }, ack: h.ack, client: h.client, logger: h.logger });
  assert.deepEqual(h.events.slice(0, 3).map((e) => e[0]), ['ack', 'open', 'read_reviews']);
  assert.equal(h.events.find((e) => e[0] === 'update')[1].view.callback_id, 'annual_review_pdf_submit');
});

test('clears the print modal before exporting the saved review and sends PDF only to the requesting HR DM', async () => {
  const h = harness();
  const original = JSON.stringify(review());
  await h.handlers.annual_review_pdf_submit({ ack: h.ack, client: h.client, logger: h.logger, body: { user: { id: 'UHR' } }, view: {
    private_metadata: JSON.stringify({ requesterId: 'UHR' }), state: { values: { annual_print_case: { annual_print_case_select: { selected_option: { value: 'PERF-PRINT-001' } } } } },
  } });
  assert.deepEqual(h.events[0], ['ack', { response_action: 'clear' }]);
  const upload = h.events.find((e) => e[0] === 'upload')[1];
  assert.equal(upload.channel_id, 'DHRPRIVATE');
  assert.equal(upload.file.subarray(0, 5).toString(), '%PDF-');
  assert.equal(upload.filename, 'Saudi_HTC_Annual_Review_PERF-PRINT-001.pdf');
  assert.equal(h.events.find((e) => e[0] === 'dm')[1].users, 'UHR');
  assert.ok(h.events.filter((e) => e[0] === 'message').every((e) => e[1].channel === 'UHR'));
  assert.equal(h.writes.length, 0);
  assert.equal(JSON.stringify(review()), original);
});

test('allows HR to print the existing manager-signed review before the employee electronic signature, without marking it completed', async () => {
  const existing = review({ status: 'Awaiting Employee Signature' });
  const h = harness({ cases: [existing] });
  await h.handlers['/download-annual-review']({ command: { user_id: 'UHR', text: existing.caseId }, ack: h.ack, client: h.client, logger: h.logger });
  assert.ok(h.events.some((e) => e[0] === 'upload'));
  assert.equal(existing.status, 'Awaiting Employee Signature');
  assert.equal(h.writes.length, 0);
});

test('rechecks print-menu requester and current review eligibility on submission', async () => {
  const h = harness({ cases: [review({ status: 'Discussion Open' })] });
  await h.handlers.annual_review_pdf_submit({ ack: h.ack, client: h.client, logger: h.logger, body: { user: { id: 'UHR' } }, view: {
    private_metadata: JSON.stringify({ requesterId: 'UHR' }), state: { values: { annual_print_case: { annual_print_case_select: { selected_option: { value: 'PERF-PRINT-001' } } } } },
  } });
  assert.equal(h.events.filter((e) => e[0] === 'upload').length, 0);
  assert.match(h.events.find((e) => e[0] === 'message')[1].text, /not ready to print/);
  const other = harness();
  await other.handlers.annual_review_pdf_submit({ ack: other.ack, client: other.client, logger: other.logger, body: { user: { id: 'UHR' } }, view: { private_metadata: JSON.stringify({ requesterId: 'UOTHER' }), state: { values: {} } } });
  assert.equal(other.events[0][1].response_action, 'errors');
  assert.equal(other.events.filter((e) => e[0] === 'read_case').length, 0);
});

test('rejects uploads to a non-DM destination and explains missing file permissions without exposing review text', async () => {
  const h = harness();
  h.client.conversations.open = async () => ({ channel: { id: 'CPUBLIC' } });
  await h.handlers['/download-annual-review']({ command: { user_id: 'UHR', text: 'PERF-PRINT-001' }, ack: h.ack, client: h.client, logger: h.logger });
  assert.equal(h.events.filter((e) => e[0] === 'upload').length, 0);
  assert.match(printErrorMessage({ data: { error: 'missing_scope' } }), /files:write/);
  assert.doesNotMatch(JSON.stringify(h.logs), /Example Employee|overallRating|managerSignature/);
});

test('replaces an expired print-options click with a new private button instead of doing Sheets work', async () => {
  const h = harness();
  h.client.views.open = async () => { throw { data: { error: 'expired_trigger_id' } }; };
  await h.handlers['/download-annual-review']({ command: { user_id: 'UHR', trigger_id: 'EXPIRED', text: '' }, ack: h.ack, client: h.client, logger: h.logger });
  const message = h.events.find((e) => e[0] === 'message')[1];
  assert.equal(message.channel, 'UHR');
  assert.equal(message.blocks[1].elements[0].action_id, 'open_annual_review_print_options');
  assert.equal(h.events.filter((e) => e[0] === 'read_reviews').length, 0);
});

test('skips invalid or overlong stored case IDs without breaking the print selector', () => {
  assert.equal(canPrintAnnualReview(review({ caseId: 'PERF-' + 'X'.repeat(71) })), false);
  assert.equal(canPrintAnnualReview(review({ caseId: undefined })), false);
  const modal = printSelectionModal([review(), review({ caseId: 'PERF-' + 'X'.repeat(200) })], 'UHR');
  const options = modal.blocks.find((b) => b.type === 'input').element.options;
  assert.equal(options.length, 1);
  assert.ok(options.every((o) => o.value.length <= 75));
});

test('acknowledges an incomplete view submission safely without doing any external work', async () => {
  const h = harness();
  await h.handlers.annual_review_pdf_submit({ ack: h.ack, client: h.client, logger: h.logger, body: { user: { id: 'UHR' } }, view: { private_metadata: JSON.stringify({ requesterId: 'UHR' }) } });
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][1].response_action, 'errors');
});

test('does not create a duplicate PDF when the same HR request is already generating', async () => {
  let release;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = harness({ generatePdf: async () => { entered(); await blocked; return Buffer.from('%PDF-1.7\nTEST'); } });
  const args = { command: { user_id: 'UHR', text: 'PERF-PRINT-001' }, ack: h.ack, client: h.client, logger: h.logger };
  const first = h.handlers['/download-annual-review'](args);
  await started;
  await h.handlers['/download-annual-review'](args);
  release();
  await first;
  assert.equal(h.events.filter((e) => e[0] === 'upload').length, 1);
  assert.ok(h.events.some((e) => e[0] === 'message' && /already being prepared/.test(e[1].text)));
});

test('exports a real PDF from the existing saved case through the private Slack command flow', async () => {
  const { generateAnnualReviewPdf } = require('../src/utils/annualReviewPdf');
  const h = harness({ generatePdf: generateAnnualReviewPdf });
  await h.handlers['/download-annual-review']({ command: { user_id: 'UHR', text: 'PERF-PRINT-001' }, ack: h.ack, client: h.client, logger: h.logger });
  const uploads = h.events.filter((e) => e[0] === 'upload');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][1].channel_id, 'DHRPRIVATE');
  assert.ok(uploads[0][1].file.length > 15000);
  assert.equal(uploads[0][1].file.subarray(0, 5).toString(), '%PDF-');
  assert.equal(h.writes.length, 0);
  assert.equal(h.logs.length, 0);
});
