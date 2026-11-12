const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function loadSheets() {
  const calls = [];
  const employeeRow = ['Fictional Employee', 'UFICTEMP', 'UFICTMANAGER', 21, 6, 15, 2, 0, 'NO', 'NO', 'Analyst', 'Operations', '', '', 'NO', '2-Level', '', 'UFICTACK', 'Existing S data: do not overwrite', 92, 'YES'];
  const requestRow = ['2026-11-12', 'Fictional Employee', 'UFICTEMP', 'Maternity', '2026-11-12', '2027-02-11', 92, 'Pending Documents', 'Fictional notes', 'PENDING_UPLOAD', 'REQ-FICT', '', '', '', '2026-11-12', '2027-02-12', 'Calendar'];
  const sheets = { spreadsheets: { values: {
    get: async (args) => { calls.push(['get', args]); return { data: { values: args.range.startsWith('Employee Balances') ? [employeeRow] : [[], requestRow] } }; },
    append: async (args) => { calls.push(['append', args]); return { data: {} }; },
    update: async (args) => { calls.push(['update', args]); return { data: {} }; },
    batchUpdate: async (args) => { calls.push(['batch_update', args]); return { data: {} }; },
  } } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/utils/sheets.js'), 'utf8'), {
    module, exports: module.exports, require: (id) => { assert.equal(id, 'googleapis'); return { google: { auth: { GoogleAuth: class {} }, sheets: () => sheets } }; },
    process: { env: { GOOGLE_SPREADSHEET_ID: 'FICTIONAL-SHEET', GOOGLE_SERVICE_ACCOUNT_JSON: '{}' } }, console,
  });
  return { api: module.exports, calls, employeeRow, requestRow };
}

test('reads Maternity Leave Recorded from T without interpreting the occupied S column', async () => {
  const h = loadSheets(); const [employee] = await h.api.getAllEmployees();
  assert.equal(h.calls[0][1].range, 'Employee Balances!A2:U');
  assert.equal(employee.maternityUsed, 92); assert.equal(employee.annualRemaining, 15);
  assert.equal(employee.managerSlackId, 'UFICTMANAGER'); assert.equal(employee.finalAcknowledgerSlackId, 'UFICTACK');
  assert.equal(employee.maternityEligible, true);
  h.employeeRow.splice(19); const [legacy] = await h.api.getAllEmployees(); assert.equal(legacy.maternityUsed, 0);
  assert.equal(legacy.maternityEligible, false);
});

test('single and batch maternity balance updates write only T, never S or annual balance columns', async () => {
  const h = loadSheets();
  await h.api.updateEmployeeBalance(2, 'maternityUsed', 92);
  assert.equal(h.calls[0][1].range, 'Employee Balances!T2');
  assert.equal(h.calls[0][1].requestBody.values[0][0], 92);
  await h.api.updateEmployeeBalances(2, { maternityUsed: 0 });
  const data = h.calls[1][1].requestBody.data;
  assert.equal(data.length, 1); assert.equal(data[0].range, 'Employee Balances!T2');
  assert.equal(h.employeeRow[18], 'Existing S data: do not overwrite');
});

test('saves delivery date O, calendar return P and day basis Q with mandatory Pending Documents status', async () => {
  const h = loadSheets(); await h.api.addLeaveRequest({ employeeName: 'Fictional Employee', slackUserId: 'UFICTEMP', leaveType: 'Maternity',
    startDate: '2026-11-12', endDate: '2027-02-11', totalDays: 92, status: 'Pending Documents', requestId: 'REQ-FICT', notes: 'Fictional notes',
    attachmentUrls: 'PENDING_UPLOAD', deliveryDate: '2026-11-12', returnDate: '2027-02-12' });
  const write = h.calls[0][1]; const row = write.requestBody.values[0];
  assert.equal(write.range, 'Leave Requests!A:Q'); assert.equal(row.length, 17);
  assert.equal(row[7], 'Pending Documents'); assert.equal(row[8], 'Fictional notes'); assert.equal(row[10], 'REQ-FICT');
  assert.equal(row[14], '2026-11-12'); assert.equal(row[15], '2027-02-12'); assert.equal(row[16], 'Calendar');
  await h.api.addLeaveRequest({ leaveType: 'Annual', requestId: 'REQ-ANNUAL' });
  const annual = h.calls[1][1].requestBody.values[0]; assert.equal(annual[16], 'Working'); assert.equal(annual[14], '');
});

test('returns saved maternity delivery and return dates by request ID and employee without shifting status', async () => {
  const h = loadSheets(); const request = await h.api.getLeaveRequestById('REQ-FICT');
  assert.equal(request.rowIndex, 2); assert.equal(request.status, 'Pending Documents');
  assert.equal(request.deliveryDate, '2026-11-12'); assert.equal(request.returnDate, '2027-02-12'); assert.equal(request.dayBasis, 'Calendar');
  const [same] = await h.api.getLeaveRequestsBySlackId('UFICTEMP'); assert.equal(same.deliveryDate, request.deliveryDate); assert.equal(same.returnDate, request.returnDate);
});

test('only an explicit YES in U enables maternity; NO, blank and other inputs are disabled', async () => {
  for (const [cell, expected] of [['YES', true], [' yes ', true], ['NO', false], ['', false], [undefined, false], ['Female', false], ['TRUE', false], [1, false]]) {
    const h = loadSheets(); h.employeeRow[20] = cell;
    const [employee] = await h.api.getAllEmployees();
    assert.equal(employee.maternityEligible, expected);
    assert.equal(employee.maternityUsed, 92);
  }
});

test('leave counter update helpers do not allow changing the HR-controlled eligibility field', async () => {
  const h = loadSheets();
  await assert.rejects(h.api.updateEmployeeBalance(2, 'maternityEligible', true), /Unknown field/);
  await assert.rejects(h.api.updateEmployeeBalances(2, { maternityEligible: true }), /Unknown field/);
  assert.equal(h.calls.length, 0);
});
