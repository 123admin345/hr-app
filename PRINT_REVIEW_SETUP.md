# Print the submitted annual review for handwritten signatures

You do not need the employee or manager to submit another review. This update adds an HR-only command that creates a printable PDF from the answers already saved in the existing annual-review case.

The new command is:

```text
/download-annual-review
```

It is not available until you complete the code upload and Slack setup below.

## What the PDF contains

The print copy includes the full Saudi HTC Annual Performance Review & Growth Plan, Parts 1–9: objectives, results and manager commentary; the five 5Bs with both employee and manager ratings and observations; project performance; 360 feedback; all three employee self-reflection answers; the recorded overall score, rating and Keeper assessment; growth goals; Core Message; and signatures.

The sections, values, descriptions, rating definitions and weights follow the CEO-approved document you provided. The layout is reformatted for printing and may have a different page count; it is not an identical Word-layout reproduction. Long answers are allowed to continue onto more pages instead of being cut off.

Part 9 has blank **Manager Signature / Date** and **Employee Signature / Date** lines for handwritten signing. If the app already recorded typed electronic signatures, those are shown separately as the existing system record. They do not replace the blank handwritten signature lines.

The PDF does not change scores or recalculate the manager's overall rating. The original Weighted Score cells were not captured by the Slack app, so those remain marked as not recorded rather than invented.

Existing job title and department information comes from Employee Balances; do not treat those as a frozen historical snapshot if the employee's role has since changed. The stored review answers and signatures come from the selected review case.

---

## Step 1 — Download the newest complete app ZIP

Use:

```text
SLACK_HR_APP_ANNUAL_REVIEW_PRINT_PDF.zip
```

Extract the ZIP on your computer. Inside it you should see:

```text
index.js
package.json
package-lock.json
Procfile
ARCHITECTURE.md
src/
test/
assets/
```

**The new `assets` folder is required.** It contains the embedded document fonts. Upload it together with `src` and all the root files.

Never upload `.env`, Slack tokens, Google service-account credentials or `node_modules`.

## Step 2 — Upload the code to your existing GitHub repository

1. Sign into your GitHub account.
2. Open <https://github.com/123admin345/hr-app>.
3. Make sure the selected branch is `main`.
4. Stay on the repository's main page, where `index.js`, `package.json` and `src` are visible. Do not open `src` before uploading the whole app.
5. Click **Add file** → **Upload files**.
6. Drag the contents of the extracted ZIP into the upload area. Upload the contents, not an outer folder containing the app, and not the ZIP itself.
7. Confirm `assets`, `src` and `test` keep their folder paths.
8. At the bottom, enter this commit message:

   ```text
   Add HR annual review printable PDF
   ```

9. Commit the changes to `main`.

If auto-deploy is enabled, Render may start deploying immediately. Wait until your whole upload is committed before manually deploying again.

The package includes the previous leave, visa, new-hire, annual review and recovery code. It does **not** implement the separately discussed `2-Level-Approve` leave route. Existing `2-Level` still means manager approval followed by acknowledgement; do not enter the new unimplemented route name in Google Sheets.

---

## Step 3 — Add Slack permission to send a PDF

Use the Slack account that manages your existing **HR System** app. Do not create a second Slack app.

1. Open <https://api.slack.com/apps>.
2. Select the existing **HR System** app used for your leave and performance commands.
3. Click **OAuth & Permissions** in the left menu.
4. Scroll to **Scopes** → **Bot Token Scopes**.
5. Click **Add an OAuth Scope**.
6. Add:

   ```text
   files:write
   ```

7. Confirm these existing scopes are present too:

   ```text
   im:write
   chat:write
   commands
   ```

   If any is missing, add it. Do not remove existing scopes, including `files:read` used by the private leave-document workflow.

8. After adding scopes, click **Reinstall to Workspace** or **Install to Workspace**, then **Allow** for your company's workspace.
9. In **OAuth & Permissions**, check the **Bot User OAuth Token**.
10. If Slack issued a new bot token, replace `SLACK_BOT_TOKEN` in Render with that token. Do not put a token in a Google Sheet, GitHub file, or message.

To update a changed token in Render: open **hr-app** → **Environment** (or service settings containing environment variables) → edit the existing `SLACK_BOT_TOKEN` entry → paste the new value → save/redeploy. No new Google credential or spreadsheet is required.

---

## Step 4 — Add the new Slack command

In the same HR System app settings:

1. Click **Slash Commands** in the left menu.
2. Click **Create New Command**.
3. Enter the following values.

**Command:**

```text
/download-annual-review
```

**Request URL:**

```text
https://hr-app-lbqd.onrender.com/slack/events
```

This is the Render URL shown in your earlier screenshots. If your service's current URL is different, copy the working Request URL from your existing `/start-performance-review` command instead. Use the same `/slack/events` address; do not use `/health`.

**Short Description:**

```text
HR: download an annual review PDF for printing and signatures
```

**Usage Hint:**

```text
[optional Case ID]
```

4. Click **Save**.
5. If Slack asks you to reinstall after adding the command, reinstall to the same workspace and check the bot token again as described in Step 3.
6. Leave the existing **Interactivity & Shortcuts** Request URL unchanged. The new selection window uses the same app interactivity already working for annual reviews.

The command can be visible in Slack's command list, but the app rejects use by employees/managers who are not authorised HR. Hiding commands and enforcing permissions are different things.

---

## Step 5 — Deploy the code in Render

1. Open Render and select your existing **hr-app** service.
2. Open **Deploys**.
3. Choose **Manual Deploy** → **Deploy latest commit**.
4. Keep the build command as `npm install` or your existing `npm ci`, and the start command as `npm start`.
5. Wait until Render shows green **Live**.

Uploading the code alone does not create the Slack command. Both the code deployment and Steps 3–4 are necessary.

---

## Step 6 — Download the existing submitted review

Use your authorised **HR Slack account**, not the employee account. This is the Slack ID already authorised for HR review administration using `HR_MANAGER_ID`, `PERFORMANCE_HR_STARTER_IDS`, `VISA_HR_APPROVER_IDS` or the configured administrators. Ordinary managers are not allowed to download all employee reviews.

1. Open Slack on your computer.
2. Open your private conversation with **HR System**.
3. In the main message box, not a thread, type:

   ```text
   /download-annual-review
   ```

4. Press Enter.
5. A selection window opens.
6. Choose the employee and review period. If the person has several reviews, select the correct case.
7. Click **Create PDF**.
8. The window closes. The app tells you the PDF is being prepared.
9. Wait for the PDF file in your private HR System conversation.

The PDF is sent only to the authorised HR person who requested it. It is not posted in `#hr`, `#general`, `#social`, or another public channel. As with any Slack file, authorised workspace administration and retention rules still apply.

### If the review is not listed

The manager must have submitted their final Annual Review & Growth Plan and typed manager signature. The selector accepts these existing case statuses:

- `Completed` — both electronic signatures are recorded.
- `Awaiting Employee Signature` — the manager's final form is submitted, and HR can already print it for physical signing.

Cases still in `Discussion Open` or `Awaiting Manager Outcome` are not final forms and are not offered for printing. Do not change a case's status manually to make it printable.

If needed, find the exact Case ID in **Performance Reviews → column A**, then run:

```text
/download-annual-review PERF-...
```

Replace `PERF-...` with the actual Case ID; do not type the three dots literally. This bypasses the selection modal and is useful if the free Render service takes time to wake up.

---

## Step 7 — Print and sign

1. Click the PDF in Slack.
2. Choose **Download** (usually the down-arrow icon).
3. Open the downloaded PDF on your computer.
4. Press **Ctrl + P** on Windows or **Command + P** on Mac.
5. Select your printer.
6. Choose **A4**, portrait, all pages, with **Fit** or **Fit to printable area** if needed.
7. Print the full document.
8. In **Part 9 — Signatures**, the manager signs and dates their blank lines; the employee signs and dates theirs.
9. Put the original signed document in the employee's confidential HR personnel file.
10. Optionally scan the signed hard copy into your restricted HR employee folder, named with employee, review period and Case ID. Do not send the scan to a public Slack channel.

The print command is read-only: it does not reopen the review, deduct leave, change a rating, change a signature, or mark a review completed. A paper signature does not automatically update the Slack electronic-signature step. If that step is still awaiting employee signature, complete it separately or retain the paper copy under your HR procedure.

---

## Common problems

**Slack says the command does not exist:** Complete Step 4 in the existing HR System app and confirm you are in the same workspace.

**Slack says only HR can download:** Use your authorised HR account. If a second HR person needs access, add that person's Slack member ID to the existing comma-separated `PERFORMANCE_HR_STARTER_IDS` setting in Render. Do not change a manager's reporting line to bypass security.

**The app says it needs file permission:** Add `files:write` and confirm `im:write`, reinstall the app, and update Render's bot token if changed.

**An expired-click message appears:** Render Free may have slept. Click the new **Open Print Options** button once, or use the Case-ID version of the command. An old Slack message's age alone is not what expires: the short-lived interaction token can expire during a cold start.

**The PDF did not arrive:** Open Render → **Logs** immediately after one attempt and look for `[Annual Review PDF]`. Send the newest error code or screenshot, without tokens or employee review text.

**The PDF has a dash or Not recorded:** That field was not saved in the selected case. Do not invent a rating, target, answer, or historical signature to fill the space.

## Deployment/security note

Compatible dependency patches were applied while adding the PDF library. The current dependency audit reports five moderate advisories and no high or critical advisories; no forced major-version upgrade was made. Local tests include real PDF generation and a mocked private Slack upload. Live Slack delivery still needs one test after you deploy and grant the file permission.

The PDF renderer works directly in Node.js. Render does not need LibreOffice, a browser, Poppler or a new server service to create the PDF. Some optional developer tests use Poppler to inspect PDFs; the ordinary production build remains `npm install`/`npm ci`, followed by `npm start`.

Latin and Arabic fonts are bundled. Ordinary Arabic text was tested, but complex mixed-direction punctuation or unsupported emoji/scripts may need a visual check in the generated PDF before printing.

## Reference

Slack's supported file upload flow and required permission: <https://docs.slack.dev/messaging/working-with-files>.

Slack command setup: <https://docs.slack.dev/interactivity/implementing-slash-commands/>.
