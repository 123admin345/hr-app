const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;
let leaveRequestsSheetIdPromise;
let newHireSheetsReadyPromise;
let newHireRequestsSheetIdPromise;

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

async function getLeaveRequestsSheetId(sheets) {
  if (!leaveRequestsSheetIdPromise) {
    leaveRequestsSheetIdPromise = sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets.properties(sheetId,title)',
    })
      .then((response) => {
        const sheet = response.data.sheets?.find((item) => item.properties?.title === 'Leave Requests');
        if (!sheet) throw new Error('The Leave Requests sheet could not be found.');
        return sheet.properties.sheetId;
      })
      .catch((error) => {
        leaveRequestsSheetIdPromise = undefined;
        throw error;
      });
  }
  return leaveRequestsSheetIdPromise;
}

// ─── Employee Balances ────────────────────────────────────────────────────────

async function getAllEmployees() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Employee Balances!A2:R',
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
    exitReentryEligible: (row[14] || 'NO').toUpperCase() === 'YES', // Column O
    leaveApprovalRoute: row[15] || '',                      // Column P: blank / 3-Level
    departmentHeadSlackId: row[16] || '',                   // Column Q
    finalAcknowledgerSlackId: row[17] || '',                // Column R: final acknowledgement recipient
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

async function updateEmployeeBalances(rowIndex, updates) {
  const sheets = await getSheetsClient();
  const fieldColumnMap = {
    annualUsed: 'E',
    annualRemaining: 'F',
    sickUsed: 'G',
    hajjUsed: 'H',
  };
  const data = Object.entries(updates).map(([field, newValue]) => {
    const col = fieldColumnMap[field];
    if (!col) throw new Error(`Unknown field: ${field}`);
    return { range: `Employee Balances!${col}${rowIndex}`, values: [[newValue]] };
  });
  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data,
    },
  });
}

// ─── Leave Requests ───────────────────────────────────────────────────────────

async function addLeaveRequest(request) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:N',
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
        request.status || 'Pending',
        '',
        request.attachmentUrls || '',
        request.requestId,
        request.directManagerApproval || '',
        request.departmentHeadApproval || '',
        request.finalAcknowledgement || '',
      ]],
    },
  });
}

async function updateLeaveRequestStatus(requestId, status, managerNotes) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:N',
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

async function updateLeaveRequestApprovalData(requestId, changes = {}) {
  const request = await getLeaveRequestById(requestId);
  if (!request) throw new Error(`Request ${requestId} not found`);
  const sheets = await getSheetsClient();
  const fieldColumnMap = {
    status: 'H',
    managerNotes: 'I',
    directManagerApproval: 'L',
    departmentHeadApproval: 'M',
    finalAcknowledgement: 'N',
  };
  const data = Object.entries(changes)
    .filter(([field]) => fieldColumnMap[field])
    .map(([field, value]) => ({
      range: `Leave Requests!${fieldColumnMap[field]}${request.rowIndex}`,
      values: [[value ?? '']],
    }));
  if (data.length === 0) return request;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  return { ...request, ...changes };
}

/**
 * Atomically claims a leave request at its expected approval status before any
 * balance or notification work starts. Google Sheets changes that exact Status
 * cell only once, so two near-simultaneous Slack clicks cannot both continue.
 */
async function claimLeaveRequestDecision(requestId, processingStatus, expectedStatus = 'Pending') {
  const request = await getLeaveRequestById(requestId);
  if (!request || request.status !== expectedStatus) return { claimed: false, request };

  const sheets = await getSheetsClient();
  const sheetId = await getLeaveRequestsSheetId(sheets);
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        findReplace: {
          find: expectedStatus,
          replacement: processingStatus,
          matchCase: true,
          matchEntireCell: true,
          searchByRegex: false,
          includeFormulas: false,
          range: {
            sheetId,
            startRowIndex: request.rowIndex - 1,
            endRowIndex: request.rowIndex,
            startColumnIndex: 7, // H: Status
            endColumnIndex: 8,
          },
        },
      }],
    },
  });

  const occurrencesChanged = response.data.replies?.[0]?.findReplace?.occurrencesChanged || 0;
  if (occurrencesChanged !== 1) {
    return { claimed: false, request: await getLeaveRequestById(requestId) };
  }
  return { claimed: true, request: { ...request, status: processingStatus } };
}

async function getLeaveRequestById(requestId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:N',
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
    attachmentUrls: row[9] || '',
    requestId: row[10] || '',
    directManagerApproval: row[11] || '',
    departmentHeadApproval: row[12] || '',
    finalAcknowledgement: row[13] || '',
  };
}

async function getLeaveRequestsBySlackId(slackUserId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:N',
  });
  const rows = res.data.values || [];
  return rows
    .map((row, index) => ({ row, rowIndex: index + 1 }))
    .filter(({ row }) => row[2] === slackUserId)
    .map(({ row, rowIndex }) => ({
      rowIndex,
      status: row[7] || 'Pending',
      managerNotes: row[8] || '',
      employeeName: row[1] || '',
      slackUserId: row[2] || '',
      leaveType: row[3] || '',
      startDate: row[4] || '',
      endDate: row[5] || '',
      totalDays: Number(row[6] || 0),
      attachmentUrls: row[9] || '',
      requestId: row[10] || '',
      directManagerApproval: row[11] || '',
      departmentHeadApproval: row[12] || '',
      finalAcknowledgement: row[13] || '',
    }));
}

async function updateLeaveRequestAttachments(requestId, attachmentUrls) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Leave Requests!A:N',
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

// ─── Exit Re-Entry Visa Requests ─────────────────────────────────────────────

function visaRequestFromRow(row, rowIndex) {
  return {
    rowIndex,
    requestId: row[0] || '',
    submittedAt: row[1] || '',
    employeeName: row[2] || '',
    employeeSlackId: row[3] || '',
    purpose: row[4] || '',
    paymentResponsibility: row[5] || '',
    visaType: row[6] || '',
    requestedDuration: row[7] || '',
    departureDate: row[8] || '',
    returnDate: row[9] || '',
    destination: row[10] || '',
    employeeNotes: row[11] || '',
    status: row[12] || 'Submitted to HR',
    hrNotes: row[13] || '',
    visaReference: row[14] || '',
    validFrom: row[15] || '',
    validUntil: row[16] || '',
    collectionInstructions: row[17] || '',
    processedBy: row[18] || '',
    processedAt: row[19] || '',
  };
}

async function addVisaRequest(request) {
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Exit Re-Entry Visa Requests!A:T',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        request.requestId,
        new Date().toISOString(),
        request.employeeName,
        request.employeeSlackId,
        request.purpose,
        request.paymentResponsibility,
        request.visaType,
        request.requestedDuration,
        request.departureDate,
        request.returnDate,
        request.destination || '',
        request.employeeNotes || '',
        request.status || 'Submitted to HR',
        request.hrNotes || '',
        request.visaReference || '',
        request.validFrom || '',
        request.validUntil || '',
        request.collectionInstructions || '',
        request.processedBy || '',
        request.processedAt || '',
      ]],
    },
  });
}

async function getVisaRequestById(requestId) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Exit Re-Entry Visa Requests!A:T',
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((row) => row[0] === requestId);
  if (rowIndex === -1) return null;
  return visaRequestFromRow(rows[rowIndex], rowIndex + 1);
}

async function updateVisaRequest(requestId, request) {
  const existing = await getVisaRequestById(requestId);
  if (!existing) throw new Error(`Visa request ${requestId} not found`);
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Exit Re-Entry Visa Requests!A${existing.rowIndex}:T${existing.rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        request.requestId,
        request.submittedAt,
        request.employeeName,
        request.employeeSlackId,
        request.purpose,
        request.paymentResponsibility,
        request.visaType,
        request.requestedDuration,
        request.departureDate,
        request.returnDate,
        request.destination || '',
        request.employeeNotes || '',
        request.status,
        request.hrNotes || '',
        request.visaReference || '',
        request.validFrom || '',
        request.validUntil || '',
        request.collectionInstructions || '',
        request.processedBy || '',
        request.processedAt || '',
      ]],
    },
  });
  return { ...request, rowIndex: existing.rowIndex };
}

// ─── New Hire Requests ───────────────────────────────────────────────────────
// The tabs below are created with exact headers the first time /request-new-hire
// is used. This avoids asking HR to build a blank tab manually before a safe test.
const NEW_HIRE_REQUESTS_SHEET = 'New Hire Requests';
const COMPANY_APPROVERS_SHEET = 'Company Approvers';
const NEW_HIRE_HEADERS = [
  'Request ID', 'Submitted At', 'Requester Slack ID', 'Requester Name', 'Company',
  'Candidate / Proposed Employee Name', 'Job Title', 'Department', 'Employment Type',
  'Location', 'Target Start Date', 'Request Type', 'Budget / Salary Range',
  'Business Approver Slack ID', 'Status', 'HR Approval', 'Finance Approval',
  'Business Approval', 'Rejection Reason', 'Last Updated At', 'Replacement Employee',
  'Job Description / Key Requirements', 'Business Justification',
];
const COMPANY_APPROVER_HEADERS = ['Company', 'Business Approver Slack ID', 'Active'];
const NEW_HIRE_RANGE = `${NEW_HIRE_REQUESTS_SHEET}!A:W`;

function cleanCell(value) {
  return String(value ?? '').trim();
}

async function getSheetMetadata(sheets) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)',
  });
  return response.data.sheets || [];
}

async function ensureNewHireSheets(sheets) {
  if (!newHireSheetsReadyPromise) {
    newHireSheetsReadyPromise = (async () => {
      let metadata = await getSheetMetadata(sheets);
      const existingTitles = new Set(metadata.map((sheet) => sheet.properties?.title));
      const missingTitles = [NEW_HIRE_REQUESTS_SHEET, COMPANY_APPROVERS_SHEET]
        .filter((title) => !existingTitles.has(title));

      if (missingTitles.length > 0) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            requests: missingTitles.map((title) => ({ addSheet: { properties: { title } } })),
          },
        });
        metadata = await getSheetMetadata(sheets);
      }

      const newHireMeta = metadata.find((sheet) => sheet.properties?.title === NEW_HIRE_REQUESTS_SHEET);
      const companyMeta = metadata.find((sheet) => sheet.properties?.title === COMPANY_APPROVERS_SHEET);
      if (!newHireMeta || !companyMeta) throw new Error('Unable to create the new-hire request configuration sheets.');

      const [newHireHeaderResponse, companyHeaderResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${NEW_HIRE_REQUESTS_SHEET}!A1:W1` }),
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${COMPANY_APPROVERS_SHEET}!A1:C1` }),
      ]);
      const existingNewHireHeaders = newHireHeaderResponse.data.values?.[0] || [];
      const existingCompanyHeaders = companyHeaderResponse.data.values?.[0] || [];
      const rowsToWrite = [];
      if (!NEW_HIRE_HEADERS.every((header, index) => existingNewHireHeaders[index] === header)) {
        rowsToWrite.push({ range: `${NEW_HIRE_REQUESTS_SHEET}!A1:W1`, values: [NEW_HIRE_HEADERS] });
      }
      if (!COMPANY_APPROVER_HEADERS.every((header, index) => existingCompanyHeaders[index] === header)) {
        rowsToWrite.push({ range: `${COMPANY_APPROVERS_SHEET}!A1:C1`, values: [COMPANY_APPROVER_HEADERS] });
      }
      if (rowsToWrite.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: { valueInputOption: 'RAW', data: rowsToWrite },
        });
      }

      return {
        newHireRequestsSheetId: newHireMeta.properties.sheetId,
        companyApproversSheetId: companyMeta.properties.sheetId,
      };
    })().catch((error) => {
      newHireSheetsReadyPromise = undefined;
      throw error;
    });
  }
  return newHireSheetsReadyPromise;
}

async function getNewHireRequestsSheetId(sheets) {
  if (!newHireRequestsSheetIdPromise) {
    newHireRequestsSheetIdPromise = ensureNewHireSheets(sheets)
      .then((result) => result.newHireRequestsSheetId)
      .catch((error) => {
        newHireRequestsSheetIdPromise = undefined;
        throw error;
      });
  }
  return newHireRequestsSheetIdPromise;
}

function newHireRequestFromRow(row, rowIndex) {
  return {
    rowIndex,
    requestId: row[0] || '',
    submittedAt: row[1] || '',
    requesterSlackId: row[2] || '',
    requesterName: row[3] || '',
    company: row[4] || '',
    proposedCandidateName: row[5] || '',
    jobTitle: row[6] || '',
    department: row[7] || '',
    employmentType: row[8] || '',
    location: row[9] || '',
    targetStartDate: row[10] || '',
    requestType: row[11] || '',
    budgetSalaryRange: row[12] || '',
    businessApproverSlackId: row[13] || '',
    status: row[14] || 'Pending HR Approval',
    hrApproval: row[15] || '',
    financeApproval: row[16] || '',
    businessApproval: row[17] || '',
    rejectionReason: row[18] || '',
    lastUpdatedAt: row[19] || '',
    replacementEmployeeName: row[20] || '',
    jobRequirements: row[21] || '',
    businessJustification: row[22] || '',
  };
}

async function getCompanyBusinessApprover(company) {
  const sheets = await getSheetsClient();
  await ensureNewHireSheets(sheets);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${COMPANY_APPROVERS_SHEET}!A2:C`,
  });
  const normalizedCompany = cleanCell(company).toLowerCase();
  const row = (response.data.values || []).find((item) => (
    cleanCell(item[0]).toLowerCase() === normalizedCompany
    && cleanCell(item[1])
    && cleanCell(item[2] || 'YES').toUpperCase() !== 'NO'
  ));
  return row ? cleanCell(row[1]) : '';
}

async function addNewHireRequest(request) {
  const sheets = await getSheetsClient();
  await ensureNewHireSheets(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: NEW_HIRE_RANGE,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        request.requestId,
        request.submittedAt || new Date().toISOString(),
        request.requesterSlackId,
        request.requesterName,
        request.company,
        request.proposedCandidateName || '',
        request.jobTitle,
        request.department,
        request.employmentType,
        request.location || '',
        request.targetStartDate || '',
        request.requestType,
        request.budgetSalaryRange,
        request.businessApproverSlackId,
        request.status || 'Pending HR Approval',
        request.hrApproval || '',
        request.financeApproval || '',
        request.businessApproval || '',
        request.rejectionReason || '',
        request.lastUpdatedAt || new Date().toISOString(),
        request.replacementEmployeeName || '',
        request.jobRequirements || '',
        request.businessJustification || '',
      ]],
    },
  });
}

async function getNewHireRequestById(requestId) {
  const sheets = await getSheetsClient();
  await ensureNewHireSheets(sheets);
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: NEW_HIRE_RANGE });
  const rows = response.data.values || [];
  const rowIndex = rows.findIndex((row) => row[0] === requestId);
  if (rowIndex === -1) return null;
  return newHireRequestFromRow(rows[rowIndex], rowIndex + 1);
}

const NEW_HIRE_COLUMNS = {
  status: 'O',
  hrApproval: 'P',
  financeApproval: 'Q',
  businessApproval: 'R',
  rejectionReason: 'S',
  lastUpdatedAt: 'T',
  businessApproverSlackId: 'N',
};

async function updateNewHireRequest(requestId, changes = {}) {
  const request = await getNewHireRequestById(requestId);
  if (!request) throw new Error(`New-hire request ${requestId} not found`);
  const sheets = await getSheetsClient();
  const mergedChanges = { ...changes, lastUpdatedAt: new Date().toISOString() };
  const data = Object.entries(mergedChanges)
    .filter(([field]) => NEW_HIRE_COLUMNS[field])
    .map(([field, value]) => ({
      range: `${NEW_HIRE_REQUESTS_SHEET}!${NEW_HIRE_COLUMNS[field]}${request.rowIndex}`,
      values: [[value ?? '']],
    }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  return { ...request, ...mergedChanges };
}

/**
 * Compare-and-swap the request status before any new-hire approval work. This
 * prevents two nearly simultaneous Slack button clicks from deciding one stage.
 */
async function claimNewHireRequestDecision(requestId, processingStatus, expectedStatus) {
  const request = await getNewHireRequestById(requestId);
  if (!request || request.status !== expectedStatus) return { claimed: false, request };
  const sheets = await getSheetsClient();
  const sheetId = await getNewHireRequestsSheetId(sheets);
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        findReplace: {
          find: expectedStatus,
          replacement: processingStatus,
          matchCase: true,
          matchEntireCell: true,
          searchByRegex: false,
          includeFormulas: false,
          range: {
            sheetId,
            startRowIndex: request.rowIndex - 1,
            endRowIndex: request.rowIndex,
            startColumnIndex: 14, // O: Status
            endColumnIndex: 15,
          },
        },
      }],
    },
  });
  const occurrencesChanged = response.data.replies?.[0]?.findReplace?.occurrencesChanged || 0;
  if (occurrencesChanged !== 1) return { claimed: false, request: await getNewHireRequestById(requestId) };
  return { claimed: true, request: { ...request, status: processingStatus } };
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
const PERFORMANCE_RANGE = 'Performance Reviews!A:AG';
const PERFORMANCE_COLUMNS = {
  caseId: 'A', reviewType: 'B', openedAt: 'C', initialDueDate: 'D', discussionDueDate: 'E', status: 'F',
  employeeName: 'G', employeeSlackId: 'H', managerSlackId: 'I', contractEndDate: 'J', annualBalance: 'K',
  employeeScores: 'L', employeeOverall: 'M', employeeComments: 'N', employeeSubmittedAt: 'O',
  managerScores: 'P', managerOverall: 'Q', managerComments: 'R', managerSubmittedAt: 'S',
  meetingOptions: 'T', meetingSelected: 'U', employeeMeetingStatus: 'V', managerMeetingStatus: 'W',
  revisionAudit: 'X', finalRating: 'Y', renewalOutcome: 'Z', nextGoals: 'AA', finalNotes: 'AB',
  hrCeoDecision: 'AC', escalatedAt: 'AD', resolvedAt: 'AE', frameworkVersion: 'AF', reviewPeriod: 'AG',
};
const PERFORMANCE_HEADERS = [
  'Case ID', 'Review Type', 'Opened At', 'Initial Submission Deadline', 'Discussion Deadline', 'Status',
  'Employee Name', 'Employee Slack ID', 'Manager Slack ID', 'Contract End Date', 'Annual Leave Balance',
  'Employee Category Scores', 'Employee Overall Rating', 'Employee Comments', 'Employee Submitted At',
  'Manager Category Scores', 'Manager Overall Rating', 'Manager Comments', 'Manager Submitted At',
  'Proposed Meeting Options', 'Confirmed Meeting', 'Employee Meeting Status', 'Manager Meeting Status',
  'Revision & Audit History', 'Final Rating', 'Renewal Outcome', 'Next Goals / KPIs', 'Final Manager Notes',
  'HR / CEO Decision Notes', 'Escalated At', 'Resolved At', 'Framework Version', 'Review Period',
];

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
    resolvedAt: row[30] || '', frameworkVersion: row[31] || '', reviewPeriod: row[32] || '', rowIndex,
  };
}

function performanceReviewDataStartRow(rows) {
  const headerIndex = rows.findIndex((row) => String(row?.[0] || '').trim().toLowerCase() === 'case id');
  return headerIndex === -1 ? 0 : headerIndex + 1;
}

function hasCorrectPerformanceHeaders(row = []) {
  return PERFORMANCE_HEADERS.every((header, index) => String(row[index] || '').trim() === header);
}

function reviewRowHasAnyContent(row = []) {
  return row.some((cell) => String(cell || '').trim() !== '');
}

async function ensurePerformanceReviewSheetLayout(sheets) {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'Performance Reviews!A1:AL' });
  const rows = response.data.values || [];
  if (hasCorrectPerformanceHeaders(rows[0])) return { repairedHeaders: false, rows };

  const hasValidCaseIdInColumnA = rows.slice(1).some((row) => String(row[0] || '').trim().startsWith('PERF-'));
  if (hasValidCaseIdInColumnA) return { repairedHeaders: false, rows };

  // No correctly-positioned review record exists yet. Repair the header row once,
  // without altering the existing misplaced test rows below the headers.
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Performance Reviews!A1:AG1',
    valueInputOption: 'RAW',
    requestBody: { values: [PERFORMANCE_HEADERS] },
  });
  const repairedRows = [...rows];
  repairedRows[0] = PERFORMANCE_HEADERS;
  return { repairedHeaders: true, rows: repairedRows };
}

function nextPerformanceReviewRow(rows = []) {
  const lastOccupiedIndex = rows.reduce((lastIndex, row, index) => (
    reviewRowHasAnyContent(row) ? index : lastIndex
  ), -1);
  return Math.max(2, lastOccupiedIndex + 2);
}

function isOrphanedPerformanceReviewStart(review) {
  return review?.status === 'Initial Review Open'
    && (!Array.isArray(review.revisionAudit) || review.revisionAudit.length === 0);
}

async function getAllPerformanceReviews() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: PERFORMANCE_RANGE });
  const rows = res.data.values || [];
  const firstDataRow = performanceReviewDataStartRow(rows);
  return rows
    .map((row, index) => ({ row, rowIndex: index + 1 }))
    .filter(({ row, rowIndex }) => rowIndex > firstDataRow && Boolean(row[0]))
    .map(({ row, rowIndex }) => rowToPerformanceReview(row, rowIndex));
}

function normalizePerformanceCaseId(caseId) {
  return String(caseId || '').trim();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getPerformanceReviewCase(caseId, { attempts = 1, delayMs = 300 } = {}) {
  const normalizedCaseId = normalizePerformanceCaseId(caseId);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const reviews = await getAllPerformanceReviews();
    const review = reviews.find((item) => normalizePerformanceCaseId(item.caseId) === normalizedCaseId);
    if (review) return review;
    if (attempt < attempts) await wait(delayMs);
  }
  return null;
}

async function addPerformanceReviewCase(review) {
  const sheets = await getSheetsClient();
  const { rows } = await ensurePerformanceReviewSheetLayout(sheets);
  const nextRow = nextPerformanceReviewRow(rows);
  const initialAudit = review.revisionAudit || [{
    type: 'case_opened',
    by: 'system',
    reviewType: review.reviewType,
    at: new Date().toISOString(),
  }];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Performance Reviews!A${nextRow}:AG${nextRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[
      review.caseId, review.reviewType, review.openedAt, review.initialDueDate, '', 'Initial Review Open',
      review.employeeName, review.employeeSlackId, review.managerSlackId, review.contractEndDate || '', review.annualBalance || 0,
      '', '', '', '', '', '', '', '', '', '', '', '', JSON.stringify(initialAudit), '', '', '', '', '', '', '', review.frameworkVersion || '', review.reviewPeriod || '',
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
  const activeStatuses = new Set(['Initial Review Open', 'Discussion Open', 'Awaiting Manager Outcome', 'Awaiting Employee Signature', 'Awaiting HR / CEO Resolution', 'Initial Submission Overdue']);
  const reviews = await getAllPerformanceReviews();
  return reviews.find((review) => (
    review.employeeSlackId === employeeSlackId
    && review.reviewType === reviewType
    && activeStatuses.has(review.status)
    && !isOrphanedPerformanceReviewStart(review)
  )) || null;
}

async function archiveOrphanedPerformanceReviewStarts(employeeSlackId, reviewType) {
  const reviews = await getAllPerformanceReviews();
  const orphanedReviews = reviews.filter((review) => (
    review.employeeSlackId === employeeSlackId
    && review.reviewType === reviewType
    && isOrphanedPerformanceReviewStart(review)
  ));
  await Promise.all(orphanedReviews.map((review) => updatePerformanceReviewCase(review.caseId, {
    status: 'Start Failed Before Notification',
    finalNotes: 'This incomplete review was automatically archived because its initial opening process failed before notifications were sent.',
  })));
  return orphanedReviews.length;
}

module.exports = {
  getAllEmployees,
  getEmployeeBySlackId,
  updateEmployeeBalance,
  updateEmployeeBalances,
  addLeaveRequest,
  updateLeaveRequestStatus,
  updateLeaveRequestApprovalData,
  claimLeaveRequestDecision,
  getLeaveRequestById,
  getLeaveRequestsBySlackId,
  updateLeaveRequestAttachments,
  getEmployeesWithRemainingBalance,
  getUpcomingHolidays,
  addVisaRequest,
  getVisaRequestById,
  updateVisaRequest,
  getCompanyBusinessApprover,
  addNewHireRequest,
  getNewHireRequestById,
  updateNewHireRequest,
  claimNewHireRequestDecision,
  addSalaryRaiseRequest,
  updateSalaryRaiseStatus,
  getAllPerformanceReviews,
  performanceReviewDataStartRow,
  normalizePerformanceCaseId,
  hasCorrectPerformanceHeaders,
  nextPerformanceReviewRow,
  getPerformanceReviewCase,
  addPerformanceReviewCase,
  updatePerformanceReviewCase,
  appendPerformanceReviewAudit,
  getActivePerformanceReviewForEmployee,
  archiveOrphanedPerformanceReviewStarts,
  isOrphanedPerformanceReviewStart,
};
