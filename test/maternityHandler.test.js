const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { maternityLeavePeriod } = require('../src/utils/maternityLeave');

function harness({ employeeChanges = {}, existingRequests = [], today = '2026-11-12' } = {}) {
  const file = path.join(__dirname, '../src/handlers/leaveHandler.js');
  const realRequire = createRequire(file);
  const employee = { name: 'Fictional Employee', slackUserId: 'UFICTEMP', managerSlackId: 'UFICTMANAGER', rowIndex: 2,
    annualUsed: 6, annualRemaining: 15, sickUsed: 2, hajjUsed: 0, maternityUsed: 0, ...employeeChanges };
  const requests = new Map(existingRequests.map((r) => [r.requestId, { ...r }]));
  const events = [], handlers = {}, balanceWrites = [], logs = [];
  const sheets = {
    getEmployeeBySlackId: async (id) => { events.push(['get_employee', id]); return id === employee.slackUserId ? { ...employee } : null; },
    getLeaveRequestById: async (id) => { events.push(['get_request', id]); return requests.has(id) ? { ...requests.get(id) } : null; },
    getLeaveRequestsBySlackId: async (id) => [...requests.values()].filter((r) => r.slackUserId === id).map((r) => ({ ...r })),
    addLeaveRequest: async (r) => { events.push(['save_request', r]); requests.set(r.requestId, { status: 'Pending', ...r }); },
    updateLeaveRequestStatus: async (id, status, notes) => { Object.assign(requests.get(id), { status, managerNotes: notes }); },
    updateLeaveRequestApprovalData: async (id, changes) => { Object.assign(requests.get(id), changes); return { ...requests.get(id) }; },
    updateLeaveRequestAttachments: async (id, links) => { events.push(['save_proof', id]); Object.assign(requests.get(id), { attachmentUrls: links, status: 'Pending' }); },
    claimLeaveRequestDecision: async (id, processing, expected = 'Pending') => {
      const r = requests.get(id);
      if (!r || r.status !== expected) return { claimed: false, request: r ? { ...r } : null };
      r.status = processing;
      events.push(['claim', id, expected, processing]);
      return { claimed: true, request: { ...r } };
    },
    updateEmployeeBalance: async (row, field, value) => { balanceWrites.push({ row, field, value }); employee[field] = value; },
    updateEmployeeBalances: async (row, changes) => { balanceWrites.push({ row, ...changes }); Object.assign(employee, changes); },
  };
  const module = { exports: {} };
  const requireMock = (id) => id === '../utils/sheets' ? sheets
    : id === '../utils/dates' ? { ...realRequire(id), saudiTodayDateString: () => today } : realRequire(id);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, require: requireMock,
    process: { env: { HR_CHANNEL_ID: 'CFICTHR', FINAL_ACKNOWLEDGER_SLACK_ID: '' } }, console }, { filename: file });
  module.exports.registerLeaveHandlers({ command: (id, fn) => { handlers[id] = fn; }, action: (id, fn) => { handlers[id] = fn; }, view: (id, fn) => { handlers[id] = fn; }, event: (id, fn) => { handlers[id] = fn; } });
  const client = {
    chat: { postMessage: async (payload) => { events.push(['message', payload]); return { ok: true, channel: payload.channel, ts: '1.2' }; }, update: async (payload) => { events.push(['message_update', payload]); return { ok: true }; } },
    views: { open: async (payload) => { events.push(['open', payload]); return { view: { id: 'VFORM', hash: 'HASH' } }; }, update: async (payload) => { events.push(['view_update', payload]); return { ok: true }; } },
  };
  const ack = async (payload) => { events.push(['ack', payload]); };
  const logger = { error: (...args) => logs.push(args) };
  return { employee, requests, events, handlers, balanceWrites, logs, client, ack, logger };
}
const maternityMetadata = (changes = {}) => JSON.stringify({ leaveType: 'Maternity', deliveryDate: '2026-11-12', ...maternityLeavePeriod('2026-11-12'), notes: 'Fictional test', ...changes });
const submission = (h, changes) => h.handlers.leave_request_submit({ ack: h.ack, view: { private_metadata: maternityMetadata(changes) }, body: { user: { id: 'UFICTEMP' } }, client: h.client, logger: h.logger });
const proofEvent = (changes = {}) => ({ channel_type: 'im', channel: 'DPRIVATE', user: 'UFICTEMP', files: [{ name: 'fictional-proof.pdf', mimetype: 'application/pdf', permalink: 'https://files.slack.com/fictitious-proof' }], ...changes });
const upload = (h, event = proofEvent()) => h.handlers.message({ event, client: h.client, logger: h.logger });
const approve = (h, requestId, user = 'UFICTMANAGER') => h.handlers.approve_leave({ ack: h.ack, action: { value: JSON.stringify({ requestId }) }, body: { user: { id: user }, channel: { id: 'DMANAGER' }, message: { ts: '1.2' } }, client: h.client, logger: h.logger });
const payloadText = (event) => JSON.stringify(event[1]);

test('choosing Maternity swaps to the delivery form without reading Sheets', async () => {
  const h = harness();
  await h.handlers.leave_type_select({ ack: h.ack, action: { selected_option: { value: 'Maternity' } }, body: { user: { id: 'UFICTEMP' }, view: { id: 'VFORM', hash: 'HASH', callback_id: 'leave_request_review', state: { values: {} } } }, client: h.client, logger: h.logger });
  assert.equal(h.events[0][0], 'ack');
  assert.equal(h.events.find((e) => e[0] === 'view_update')[1].view.callback_id, 'maternity_leave_review');
  assert.equal(h.events.filter((e) => e[0] === 'get_employee').length, 0);
});

test('maternity review confirms calculated calendar dates promptly and rejects an estimated future date', async () => {
  const h = harness();
  await h.handlers.maternity_leave_review({ ack: h.ack, view: { state: { values: { delivery_date_block: { delivery_date_pick: { selected_date: '2026-11-12' } }, notes_block: { notes_input: { value: '' } } } } } });
  assert.equal(h.events[0][1].response_action, 'push');
  const metadata = JSON.parse(h.events[0][1].view.private_metadata);
  assert.equal(metadata.endDate, '2027-02-11');
  assert.equal(metadata.returnDate, '2027-02-12');
  assert.match(JSON.stringify(h.events[0][1].view), /calendar day/);
  const bad = harness();
  await bad.handlers.maternity_leave_review({ ack: bad.ack, view: { state: { values: { delivery_date_block: { delivery_date_pick: { selected_date: '2026-11-13' } } } } } });
  assert.equal(bad.events[0][1].response_action, 'errors');
  assert.match(bad.events[0][1].errors.delivery_date_block, /future/);
});

test('submitting maternity stores Pending Documents with exact delivery/end/return dates, no balance changes or manager actions', async () => {
  const h = harness();
  await submission(h, { startDate: '2000-01-01', endDate: '2099-01-01', returnDate: '2099-01-02' });
  assert.equal(h.events[0][0], 'ack');
  assert.equal(h.events[0][1].response_action, 'clear');
  const request = [...h.requests.values()][0];
  assert.equal(request.status, 'Pending Documents');
  assert.equal(request.deliveryDate, '2026-11-12');
  assert.equal(request.startDate, '2026-11-12');
  assert.equal(request.endDate, '2027-02-11');
  assert.equal(request.returnDate, '2027-02-12');
  assert.equal(request.totalDays, 92);
  assert.equal(request.attachmentUrls, 'PENDING_UPLOAD');
  assert.equal(h.balanceWrites.length, 0);
  const messages = h.events.filter((e) => e[0] === 'message');
  assert.ok(messages.every((e) => e[1].channel === 'UFICTEMP'));
  assert.match(messages.map(payloadText).join('\n'), /Delivery-Date Proof Required/);
  assert.equal(h.logs.length, 0);
});

test('public-channel files and unsuitable documents do not satisfy maternity proof or send an approval', async () => {
  const h = harness();
  await submission(h);
  await upload(h, proofEvent({ channel_type: 'channel', channel: 'CGENERAL' }));
  await upload(h, proofEvent({ files: [{ name: 'not-proof.zip', mimetype: 'application/zip', permalink: 'https://files.slack.com/fake.zip' }] }));
  assert.equal([...h.requests.values()][0].status, 'Pending Documents');
  assert.equal(h.events.filter((e) => e[0] === 'message' && e[1].channel === 'UFICTMANAGER').length, 0);
  assert.equal(h.events.filter((e) => e[0] === 'save_proof').length, 0);
});

test('cannot approve a maternity request that is still awaiting delivery proof', async () => {
  const h = harness(); await submission(h);
  await approve(h, [...h.requests.keys()][0]);
  assert.equal([...h.requests.values()][0].status, 'Pending Documents');
  assert.equal(h.balanceWrites.length, 0);
  assert.equal(h.events.filter((e) => e[0] === 'message' && e[1].channel === 'CFICTHR').length, 0);
});

test('private PDF proof is claimed once, stored, and then forwarded with calendar days and date verification instructions', async () => {
  const h = harness(); await submission(h);
  await upload(h);
  const request = [...h.requests.values()][0];
  assert.equal(request.status, 'Pending');
  assert.match(request.attachmentUrls, /fictitious-proof/);
  const messages = h.events.filter((e) => e[0] === 'message' && e[1].channel === 'UFICTMANAGER');
  assert.equal(messages.length, 1);
  assert.match(payloadText(messages[0]), /Calendar Days/);
  assert.match(payloadText(messages[0]), /Verify that the attached official document confirms the delivery date/);
  assert.match(payloadText(messages[0]), /Calendar return date/);
  await upload(h);
  assert.equal(h.events.filter((e) => e[0] === 'message' && e[1].channel === 'UFICTMANAGER').length, 1);
  assert.equal(h.balanceWrites.length, 0);
});

test('proof upload recovers the persisted request after the in-memory state is lost on a restart', async () => {
  const first = harness(); await submission(first);
  const second = harness({ existingRequests: [...first.requests.values()] });
  await upload(second);
  assert.equal([...second.requests.values()][0].status, 'Pending');
  assert.equal(second.events.filter((e) => e[0] === 'message' && e[1].channel === 'UFICTMANAGER').length, 1);
  assert.equal(second.logs.length, 0);
});

test('final maternity approval only updates the separate counter once and preserves all other balances', async () => {
  const h = harness(); await submission(h); await upload(h);
  const id = [...h.requests.keys()][0];
  await approve(h, id);
  assert.equal(h.requests.get(id).status, 'Approved');
  assert.equal(h.balanceWrites.length, 1);
  assert.equal(h.balanceWrites[0].field, 'maternityUsed');
  assert.equal(h.employee.maternityUsed, 92);
  assert.equal(h.employee.annualUsed, 6); assert.equal(h.employee.annualRemaining, 15);
  assert.equal(h.employee.sickUsed, 2); assert.equal(h.employee.hajjUsed, 0);
  const hrMessages = h.events.filter((e) => e[0] === 'message' && e[1].channel === 'CFICTHR');
  assert.equal(hrMessages.length, 1);
  assert.match(payloadText(hrMessages[0]), /92 calendar day/);
  assert.match(payloadText(hrMessages[0]), /annual balance is unchanged/);
  assert.doesNotMatch(payloadText(hrMessages[0]), /fictitious-proof/);
  await approve(h, id);
  assert.equal(h.balanceWrites.length, 1);
  assert.equal(h.events.filter((e) => e[0] === 'message' && e[1].channel === 'CFICTHR').length, 1);
  assert.equal(h.logs.length, 0);
});

test('two-level maternity route records the counter only after the final acknowledgement', async () => {
  const h = harness({ employeeChanges: { leaveApprovalRoute: '2-Level', finalAcknowledgerSlackId: 'UFICTACK' } });
  await submission(h); await upload(h); const id = [...h.requests.keys()][0];
  await approve(h, id);
  assert.equal(h.requests.get(id).status, 'Pending Final Acknowledgement');
  assert.equal(h.balanceWrites.length, 0);
  const nextMessage = h.events.find((e) => e[0] === 'message' && e[1].channel === 'UFICTACK')[1];
  const buttons = nextMessage.blocks.flatMap((block) => block.elements || []);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].action_id, 'acknowledge_leave');
  await h.handlers.acknowledge_leave({ ack: h.ack, action: { value: JSON.stringify({ requestId: id }) }, body: { user: { id: 'UFICTACK' }, channel: { id: 'DACK' }, message: { ts: '1.2' } }, client: h.client, logger: h.logger });
  assert.equal(h.requests.get(id).status, 'Approved'); assert.equal(h.employee.maternityUsed, 92);
  assert.equal(h.balanceWrites.length, 1);
  assert.equal(h.logs.length, 0);
});

test('blocks a second maternity request for the same delivery date and does not overwrite a pending upload', async () => {
  const h = harness(); await submission(h); await submission(h);
  assert.equal(h.requests.size, 1);
  assert.ok(h.events.some((e) => e[0] === 'message' && /already recorded/.test(e[1].text)));
  assert.equal(h.balanceWrites.length, 0);
});

test('actual future delivery dates are rejected again at final submission and never saved', async () => {
  const h = harness(); await submission(h, { deliveryDate: '2026-11-13' });
  assert.equal(h.requests.size, 0);
  assert.ok(h.events.some((e) => e[0] === 'message' && /future/.test(e[1].text)));
});

test('no manager-supplied button may count maternity without persisted proof and matching dates', async () => {
  const h = harness({ existingRequests: [{ requestId: 'REQ-FICTINVALID', employeeName: 'Fictional Employee', slackUserId: 'UFICTEMP', leaveType: 'Maternity', ...maternityLeavePeriod('2026-11-12'), deliveryDate: '2026-11-12', status: 'Pending', attachmentUrls: 'PENDING_UPLOAD' }] });
  await approve(h, 'REQ-FICTINVALID');
  assert.equal(h.balanceWrites.length, 0);
  assert.equal(h.requests.get('REQ-FICTINVALID').status, 'Approval Needs HR Review');
});

module.exports = { harness, submission, upload, approve, proofEvent };

test('annual leave still forwards immediately without documents and deducts only annual days on approval', async () => {
  const h = harness();
  await h.handlers.leave_request_submit({ ack: h.ack, body: { user: { id: 'UFICTEMP' } }, view: { private_metadata: JSON.stringify({ leaveType: 'Annual', startDate: '2026-11-15', endDate: '2026-11-16', notes: '' }) }, client: h.client, logger: h.logger });
  const request = [...h.requests.values()][0];
  assert.equal(request.status, 'Pending'); assert.equal(request.totalDays, 2);
  assert.equal(h.events.filter((e) => e[0] === 'message' && e[1].channel === 'UFICTMANAGER').length, 1);
  await approve(h, request.requestId);
  assert.equal(h.employee.annualUsed, 8); assert.equal(h.employee.annualRemaining, 13);
  assert.equal(h.employee.maternityUsed, 0); assert.equal(h.employee.sickUsed, 2);
  assert.equal(h.logs.length, 0);
});

test('sick and Hajj leave still receive private document prompts and use their existing separate balances', async () => {
  for (const leaveType of ['Sick', 'Hajj']) {
    const h = harness();
    await h.handlers.leave_request_submit({ ack: h.ack, body: { user: { id: 'UFICTEMP' } }, view: { private_metadata: JSON.stringify({ leaveType, startDate: '2026-11-15', endDate: '2026-11-16', notes: '' }) }, client: h.client, logger: h.logger });
    const id = [...h.requests.keys()][0];
    assert.equal(h.requests.get(id).status, 'Pending Documents');
    assert.equal(h.events.filter((e) => e[0] === 'message' && e[1].channel === 'UFICTMANAGER').length, 0);
    await upload(h); await approve(h, id);
    assert.equal(h.requests.get(id).status, 'Approved');
    assert.equal(h.employee.annualRemaining, 15); assert.equal(h.employee.maternityUsed, 0);
    assert.equal(leaveType === 'Sick' ? h.employee.sickUsed : h.employee.hajjUsed, leaveType === 'Sick' ? 4 : 1);
    assert.equal(h.logs.length, 0);
  }
});
