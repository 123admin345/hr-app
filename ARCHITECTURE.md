# Slack HR App Architecture

## Overview
A custom Slack app built with Node.js and the `@slack/bolt` framework. It uses Google Sheets as the database to store employee balances, leave requests, and public holidays.

## Tech Stack
- **Framework:** Node.js with `@slack/bolt`
- **Database:** Google Sheets API (`googleapis`)
- **Scheduling:** `node-cron` for automated reminders and announcements
- **Hosting:** Designed to be deployed on a free cloud platform (e.g., Render, Railway)

## Data Models (Google Sheets)
1. **Employee Balances:**
   - Employee Name
   - Slack User ID
   - Manager Slack ID
   - Annual Balance (Total)
   - Annual Used
   - Annual Remaining
   - Sick Days Used
   - Rollover Allowed (YES/NO)

2. **Leave Requests:**
   - Timestamp
   - Employee Name
   - Slack User ID
   - Leave Type (Annual, Sick, Hajj)
   - Start Date
   - End Date
   - Total Days
   - Status (Pending, Approved, Rejected, Cancelled)
   - Manager Notes
   - Attachment URLs (for Sick/Hajj)
   - Request ID
   - Direct Manager Approval
   - Department Head Approval
   - Final Acknowledgement

3. **Public Holidays:**
   - Holiday Name
   - Date

4. **Exit Re-Entry Visa Requests:**
   - Request ID
   - Submitted At
   - Employee Name and Slack User ID
   - Purpose (Work or Personal)
   - Payment Responsibility (Company paid or Employee paid)
   - Visa Type (Single or Multiple)
   - Requested Duration
   - Planned Departure and Return Dates
   - Status and HR issuance details

## Workflow Logic
1. **Request Leave (`/leave` command):**
   - Opens a Slack modal.
   - User selects Leave Type, Start Date, End Date, Manager.
   - If Sick or Hajj, prompts for file upload (Slack file share).
   - Submits request.
   - App sends a direct message to the selected Manager with Approve/Reject buttons.

2. **Leave Approval:**
   - Standard employees follow the existing single-manager approval route.
   - Employees marked `2-Level` in Employee Balances column P follow: Direct Manager approval → Final acknowledgement.
   - Employees marked `3-Level` in Employee Balances column P follow: Direct Manager approval → Department Head approval → Final acknowledgement.
   - The Department Head Slack ID is stored per affected employee in column Q. The final acknowledgement recipient’s Slack ID is stored per affected employee in column R, allowing the actual appropriate person to be selected without assigning an artificial job title.
   - Each next person receives a private Slack message showing earlier approvals. An intermediate approval does not deduct leave, notify HR, or notify the employee that leave is confirmed.
   - The final recipient sees one `Acknowledge` button only, with no Approve or Reject button. Their acknowledgement records that the completed approval route has been seen, then confirms the leave, deducts the balance, notifies the employee, and posts the summary to HR.
   - The Direct Manager or Department Head may reject while their approval is required. A final acknowledgement cannot reject the request.

3. **Employee Cancellation (`/cancel-leave` command):**
   - Employee can cancel their own approved leave only before its start date.
   - App restores the related annual, sick, or Hajj balance automatically.
   - App marks the leave request as Cancelled in Google Sheets.
   - App notifies the employee, their manager, and HR privately. No `#general` or `#social` announcement is sent.

4. **Automated Jobs:**
   - **Contract and Performance Reviews:** Opens contract reviews approximately 75 days before contract end dates, runs semi-annual review checks, and processes review deadlines.
   - **Public Holidays:** Runs weekly. Checks upcoming holidays and posts to `#general`.
   - **HR Reports:** Sends monthly leave and performance-review reports privately to HR.

5. **Exit Re-Entry Visa (`/request-exit-reentry-visa` command):**
   - Foreign employees marked as eligible in column O can submit exit re-entry visa requests in Slack.
   - Work-related requests are marked company paid. Personal requests are marked employee paid.
   - Requests go directly to HR. HR records whether the visa was issued, needs more information, or cannot be issued.
   - Employee receives the final result privately in Slack after HR completes the official issuance process.

6. **Saudi HTC Annual Performance Review & Growth Plan (`/start-performance-review` command):**
   - Manager or HR selects the Saudi HTC Annual Performance Review type and records the review period.
   - Managers can start a review only for their direct reports. The HR Manager, owner, configured admins, and users in `PERFORMANCE_HR_STARTER_IDS` or existing `VISA_HR_APPROVER_IDS` can start and administer a review for any registered employee.
   - The Slack forms reproduce the CEO-approved review: Results, Values, Project-Based Performance, 360-Degree Feedback Summary, Employee Self-Reflection, Overall Performance Assessment, Growth & Development Plan, Core Message, and Signatures.
   - **First annual review:** because no earlier KPI/OKR plan is recorded, the employee privately completes the three past Objective/Key Result/Target/Actual/Score entries, all five Saudi HTC 5Bs self-ratings using the visible approved 1–5 scale and value descriptions, and Part 5 Employee Self-Reflection. The manager privately completes 5Bs Manager Ratings and Observations; after the discussion window, the manager adds Part 1 Manager Commentary on the employee-entered objectives.
   - **Later annual review:** the manager privately records the three objectives agreed in the employee’s completed prior Growth & Development Plan, Manager Commentary on Results, and 5Bs Manager Ratings/Observations. The employee completes the 5Bs self-ratings and Part 5 Employee Self-Reflection.
   - Part 4 360-Degree Feedback Summary is manager-only and remains in the final manager form.
   - After the existing documented discussion and edit window, the manager completes the remaining approved sections, selects the final performance rating, and types the Manager Signature. The app does not invent an automatic rating, a self-overall score, or a project-score reweighting rule.
   - The employee then types the Employee Signature and may add Employee Comments (Optional). Google Sheets keeps the confidential final HR record.

## File Structure
- `index.js`: Main entry point, initializes Bolt app and cron jobs.
- `src/handlers/`: Contains command, action, and view submission handlers.
- `src/modals/`: Contains Block Kit JSON for modals.
- `src/utils/`: Google Sheets integration and Slack API helpers.
- `src/schedulers/`: Cron job definitions.
