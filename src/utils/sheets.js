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
    range: 'Employee Balances!A2:N',
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
    jobTitle: row[10] || '',                                // Column K
    department: row[11] || '',                              // Column L
    contractStartDate: row[12] || '',                       // Column M
    contractEndDate: row[13] || '',                         // Column N
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

async function getLeaveRequestById(requestId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:K',
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[10] === requestId);
  if (rowIndex === -1) return null;
  const row = rows[rowIndex];
  return {
    rowIndex: rowIndex + 1,
    status: row[7] || 'Pending',
    managerNotes: row[8] || '',
    employeeName: row[1] || '',
    slackUserId: row[2] || '',
    leaveType: row[3] || '',
    startDate: row[4] || '',
    endDate: row[5] || '',
    totalDays: Number(row[6] || 0),
    requestId: row[10] || '',
  };
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

// ─── Performance Reviews ──────────────────────────────────────────────────────
// The Performance Reviews sheet stores one row per review case. JSON cells preserve
// category-level ratings and revisions without exposing them in public Slack channels.
const PERFORMANCE_RANGE = 'Performance Reviews!A:AE';
const PERFORMANCE_COLUMNS = {
  caseId: 'A', reviewType: 'B', openedAt: 'C', initialDueDate: 'D', discussionDueDate: 'E', status: 'F',
  employeeName: 'G', employeeSlackId: 'H', managerSlackId: 'I', contractEndDate: 'J', annualBalance: 'K',
  employeeScores: 'L', employeeOverall: 'M', employeeComments: 'N', employeeSubmittedAt: 'O',
  managerScores: 'P', managerOverall: 'Q', managerComments: 'R', managerSubmittedAt: 'S',
  meetingOptions: 'T', meetingSelected: 'U', employeeMeetingStatus: 'V', managerMeetingStatus: 'W',
  revisionAudit: 'X', finalRating: 'Y', renewalOutcome: 'Z', nextGoals: 'AA', finalNotes: 'AB',
  hrCeoDecision: 'AC', escalatedAt: 'AD', resolvedAt: 'AE',
};

function safeJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_error) { return fallback; }
}

function rowToPerformanceReview(row, rowIndex) {
  return {
    caseId: row[0] || '', reviewType: row[1] || '', openedAt: row[2] || '', initialDueDate: row[3] || '',
    discussionDueDate: row[4] || '', status: row[5] || '', employeeName: row[6] || '', employeeSlackId: row[7] || '',
    managerSlackId: row[8] || '', contractEndDate: row[9] || '', annualBalance: Number(row[10] || 0),
    employeeScores: safeJson(row[11], {}), employeeOverall: Number(row[12] || 0), employeeComments: row[13] || '',
    employeeSubmittedAt: row[14] || '', managerScores: safeJson(row[15], {}), managerOverall: Number(row[16] || 0),
    managerComments: row[17] || '', managerSubmittedAt: row[18] || '', meetingOptions: safeJson(row[19], []),
    meetingSelected: safeJson(row[20], null), employeeMeetingStatus: row[21] || '', managerMeetingStatus: row[22] || '',
    revisionAudit: safeJson(row[23], []), finalRating: Number(row[24] || 0), renewalOutcome: row[25] || '',
    nextGoals: row[26] || '', finalNotes: row[27] || '', hrCeoDecision: row[28] || '', escalatedAt: row[29] || '',
    resolvedAt: row[30] || '', rowIndex,
  };
}

async function getAllPerformanceReviews() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: PERFORMANCE_RANGE });
  const rows = res.data.values || [];
  return rows.slice(1).map((row, index) => rowToPerformanceReview(row, index + 2));
}

async function getPerformanceReviewCase(caseId) {
  const reviews = await getAllPerformanceReviews();
  return reviews.find((review) => review.caseId === caseId) || null;
}

async function addPerformanceReviewCase(review) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: PERFORMANCE_RANGE,
    valueInputOption: 'RAW',
    requestBody: { values: [[
      review.caseId, review.reviewType, review.openedAt, review.initialDueDate, '', 'Initial Review Open',
      review.employeeName, review.employeeSlackId, review.managerSlackId, review.contractEndDate || '', review.annualBalance || 0,
      '', '', '', '', '', '', '', '', '', '', '', '', JSON.stringify([]), '', '', '', '', '', '', '',
    ]] },
  });
}

async function updatePerformanceReviewCase(caseId, changes) {
  const review = await getPerformanceReviewCase(caseId);
  if (!review) throw new Error(`Performance review ${caseId} not found`);
  const sheets = await getSheetsClient();
  const data = Object.entries(changes)
    .filter(([field]) => PERFORMANCE_COLUMNS[field])
    .map(([field, value]) => ({
      range: `Performance Reviews!${PERFORMANCE_COLUMNS[field]}${review.rowIndex}`,
      values: [[typeof value === 'object' ? JSON.stringify(value) : value ?? '']],
    }));
  if (!data.length) return review;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  return { ...review, ...changes };
}

async function appendPerformanceReviewAudit(caseId, event) {
  const review = await getPerformanceReviewCase(caseId);
  if (!review) throw new Error(`Performance review ${caseId} not found`);
  const audit = [...review.revisionAudit, { ...event, at: new Date().toISOString() }];
  await updatePerformanceReviewCase(caseId, { revisionAudit: audit });
  return audit;
}

async function getActivePerformanceReviewForEmployee(employeeSlackId, reviewType) {
  const activeStatuses = new Set(['Initial Review Open', 'Discussion Open', 'Awaiting Manager Outcome', 'Awaiting HR / CEO Resolution', 'Initial Submission Overdue']);
  const reviews = await getAllPerformanceReviews();
  return reviews.find((review) => review.employeeSlackId === employeeSlackId && review.reviewType === reviewType && activeStatuses.has(review.status)) || null;
}

module.exports = {
  getAllEmployees,
  getEmployeeBySlackId,
  updateEmployeeBalance,
  addLeaveRequest,
  updateLeaveRequestStatus,
  getLeaveRequestById,
  updateLeaveRequestAttachments,
  getEmployeesWithRemainingBalance,
  getUpcomingHolidays,
  addSalaryRaiseRequest,
  updateSalaryRaiseStatus,
  getAllPerformanceReviews,
  getPerformanceReviewCase,
  addPerformanceReviewCase,
  updatePerformanceReviewCase,
  appendPerformanceReviewAudit,
  getActivePerformanceReviewForEmployee,
};
