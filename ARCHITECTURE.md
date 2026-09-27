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

2. **Manager Approval:**
   - Manager clicks Approve or Reject.
   - If Reject, a modal opens to provide feedback.
   - App updates Google Sheets.
   - App notifies the employee and HR privately after an approved request.

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

## File Structure
- `index.js`: Main entry point, initializes Bolt app and cron jobs.
- `src/handlers/`: Contains command, action, and view submission handlers.
- `src/modals/`: Contains Block Kit JSON for modals.
- `src/utils/`: Google Sheets integration and Slack API helpers.
- `src/schedulers/`: Cron job definitions.
