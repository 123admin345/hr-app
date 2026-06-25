const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: 'v4', auth });
}

// ─── Employee Balances ────────────────────────────────────────────────────────

async function getAllEmployees() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Employee Balances!A2:J',
  });
  const rows = res.data.values || [];
  return rows.map((row) => ({
    name: row[0] || '',
    slackUserId: row[1] || '',
    managerSlackId: row[2] || '',
    annualTotal: parseInt(row[3] || '21', 10),
    annualUsed: parseInt(row[4] || '0', 10),
    annualRemaining: parseInt(row[5] || '21', 10),
    sickUsed: parseInt(row[6] || '0', 10),
    hajjUsed: parseInt(row[7] || '0', 10),
    rolloverAllowed: (row[8] || 'NO').toUpperCase() === 'YES',
    isManager: (row[9] || 'NO').toUpperCase() === 'YES',   // Column J
    rowIndex: rows.indexOf(row) + 2, // 1-indexed, +1 for header
  }));
}

async function getEmployeeBySlackId(slackUserId) {
  const employees = await getAllEmployees();
  return employees.find((e) => e.slackUserId === slackUserId) || null;
}

async function updateEmployeeBalance(rowIndex, field, newValue) {
  const sheets = await getSheetsClient();
  const fieldColumnMap = {
    annualUsed: 'E',
    annualRemaining: 'F',
    sickUsed: 'G',
    hajjUsed: 'H',
  };
  const col = fieldColumnMap[field];
  if (!col) throw new Error(`Unknown field: ${field}`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Employee Balances!${col}${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[newValue]] },
  });
}

// ─── Leave Requests ───────────────────────────────────────────────────────────

async function addLeaveRequest(request) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:K',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        new Date().toISOString(),
        request.employeeName,
        request.slackUserId,
        request.leaveType,
        request.startDate,
        request.endDate,
        request.totalDays,
        'Pending',
        '',
        request.attachmentUrls || '',
        request.requestId,
      ]],
    },
  });
}

async function updateLeaveRequestStatus(requestId, status, managerNotes) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:K',
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[10] === requestId);
  if (rowIndex === -1) throw new Error(`Request ${requestId} not found`);
  const actualRow = rowIndex + 1;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `Leave Requests!H${actualRow}`, values: [[status]] },
        { range: `Leave Requests!I${actualRow}`, values: [[managerNotes || '']] },
      ],
    },
  });
  return rows[rowIndex];
}

async function updateLeaveRequestAttachments(requestId, attachmentUrls) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:K',
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[10] === requestId);
  if (rowIndex === -1) throw new Error(`Request ${requestId} not found in sheet`);
  const actualRow = rowIndex + 1;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `Leave Requests!J${actualRow}`, values: [[attachmentUrls]] },
        { range: `Leave Requests!H${actualRow}`, values: [['Pending']] }, // update status from 'Pending Documents' to 'Pending'
      ],
    },
  });
}

async function getApprovedLeavesStartingToday() {
  const sheets = await getSheetsClient();
  const today = new Date().toISOString().split('T')[0];
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:K',
  });
  const rows = res.data.values || [];
  return rows.filter((r) => r[4] === today && r[7] === 'Approved');
}

async function getEmployeesWithRemainingBalance() {
  const employees = await getAllEmployees();
  return employees.filter((e) => e.annualRemaining > 0);
}

// ─── Public Holidays ──────────────────────────────────────────────────────────

async function getUpcomingHolidays(daysAhead = 7) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Public Holidays!A2:B',
  });
  const rows = res.data.values || [];
  const today = new Date();
  const future = new Date();
  future.setDate(today.getDate() + daysAhead);
  return rows
    .filter((r) => {
      const d = new Date(r[1]);
      return d >= today && d <= future;
    })
    .map((r) => ({ name: r[0], date: r[1] }));
}

// ─── Salary Raise Requests ─────────────────────────────────────────────────────────────────────────────────

async function addSalaryRaiseRequest(request) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Salary Raises!A:L',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        new Date().toISOString(),          // A: Submitted At
        request.requestId,                  // B: Request ID
        request.managerId,                  // C: Manager Slack ID
        request.employeeName,               // D: Employee Name
        request.employeeSlackId || '',       // E: Employee Slack ID
        request.currentSalary,              // F: Current Salary
        request.newSalary,                  // G: New Salary
        request.difference,                 // H: Increase Amount
        request.percentageIncrease + '%',   // I: Increase %
        request.effectiveMonth,             // J: Effective Month
        request.reason,                     // K: Reason
        'Pending',                          // L: Status
      ]],
    },
  });
}

async function updateSalaryRaiseStatus(requestId, status, notes) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Salary Raises!A:L',
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[1] === requestId);
  if (rowIndex === -1) throw new Error(`Salary raise request ${requestId} not found`);
  const actualRow = rowIndex + 1;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `Salary Raises!L${actualRow}`, values: [[status]] },
        { range: `Salary Raises!M${actualRow}`, values: [[notes || '']] },
      ],
    },
  });
}

module.exports = {
  getAllEmployees,
  getEmployeeBySlackId,
  updateEmployeeBalance,
  addLeaveRequest,
  updateLeaveRequestStatus,
  updateLeaveRequestAttachments,
  getApprovedLeavesStartingToday,
  getEmployeesWithRemainingBalance,
  getUpcomingHolidays,
  addSalaryRaiseRequest,
  updateSalaryRaiseStatus,
};
