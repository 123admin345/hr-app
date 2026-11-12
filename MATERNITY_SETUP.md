# Add maternity leave to your existing Slack HR System

This update adds **Maternity Leave** to the leave-type choices inside your existing `/request-leave` command. The employee enters the actual delivery date and uploads a document confirming that date in the private HR System conversation. No new slash command or separate Slack workflow is needed.

The code is built locally; you must upload the updated package to GitHub and deploy it through Render before employees can use it.

## The rule implemented

Your requested company rule is **three calendar months from the actual delivery date**, with the delivery day included as the first leave day. The employee does not manually select an end date. Weekends and holidays are included. The calendar return date is the same day number three months later; when that day does not exist, the app uses that month's final day. The last leave day is the day before the return date.

Example: if delivery is **12 November 2026**, leave starts **12 November 2026**, the last leave day is **11 February 2027**, and the calendar return date is **12 February 2027**. This is **92 calendar days**, not 92 working days. If the calendar return date is a non-working day, HR confirms the first scheduled working day.

**Annual leave is not deducted.** Sick and Hajj records are also unchanged. Maternity has its own recorded-day counter.

This is your company rule, not a statement that Saudi law is exactly three calendar months. HRSD Article 151 describes **12 weeks** of maternity leave, including mandatory post-delivery weeks and arrangements that can include pre-delivery leave, extensions and special circumstances. HR should confirm compliance and handle those cases separately. This form must not be used to remove statutory rights or refuse permitted pre-delivery leave. It does not calculate payroll or determine whether a legal entitlement can be refused. [1]

## Final correction for your existing sheet

**Use this eligible-only final package instead of either earlier maternity package.** Maternity recorded days stay in T; U controls whether an employee may request maternity leave. Do not rename or delete S1 (`Employee Balances`), and do not insert a column before it. This update reads/writes maternity only in T. If maternity requests were already fully confirmed with the earlier code, ask HR/admin to reconcile those recorded totals before continuing; do not reset or copy unrelated S data into T.

## Step 1 — Add the maternity column to Employee Balances

First make a backup copy of your HR Google Sheet: **File → Make a copy**. Keep that copy restricted to the same authorised HR people.

1. Open the original HR Google Sheet used by the app.
2. Click the **Employee Balances** tab at the bottom.
3. Leave existing columns **A through S** in their current positions. Do not insert a new column between them.
4. Move to **column T**, immediately after the existing column S. Your screenshot shows that S1 already contains `Employee Balances`; leave column S unchanged.
5. If column T already contains a different field or data, **stop and tell me** rather than replacing it.
6. Click **T1** and type:

   ```text
   Maternity Leave Recorded (Calendar Days)
   ```

7. Click **T2** and type `0` for the first employee if the app has no previously recorded maternity leave for them.
8. Enter `0` in column T for the other registered employee rows as well. Use numbers only, not `NO`, `YES`, `3 months`, `90` or a formula.
9. If you already have approved maternity records you need to carry over, HR should first establish the correct recorded calendar-day total. Do not enter an invented opening balance.

After the full leave route finishes, the app adds that request's calendar days to T automatically. In the example above, an employee starting at `0` would have `92` recorded after final confirmation.

This is **recorded maternity leave**, not an entitlement balance. It is not the number of days still available or the number of days already elapsed. It has no automatic annual reset and should not be filled with an allocation of three months for every employee.

## Step 1B — Tell the app who is eligible for maternity leave

Men are not eligible for maternity leave. HR must explicitly enable the option only for eligible employees; the app does not guess eligibility from names or job titles.

1. Stay in the **Employee Balances** tab.
2. Keep the existing **S** column unchanged and **T** as the maternity recorded-day counter.
3. Check that **U** is unused, including any data further down the column. If U is occupied, stop and tell me rather than overwriting it.
4. Click **U1** and type:

   ```text
   Maternity Eligible (YES/NO)
   ```

5. In each male employee's row, enter **NO** in U.
6. In each employee's row whom HR has confirmed is eligible for maternity leave, enter **YES** in U. This makes the option available if they need to request it; it does not grant leave or add recorded days on its own.
7. For anyone not yet checked by HR, leave U blank or put **NO**. Only YES enables maternity. Do not use `Female`, `Male`, `TRUE`, numbers or a formula instead of YES/NO.
8. Optionally add a Google Sheets data-validation dropdown for the employee cells in U with only **YES** and **NO**, and restrict eligibility editing to authorised HR staff. Employees must not be able to change their own eligibility.

Example mapping:

| Field | Column | Example for an eligible employee | Example for a male employee |
|---|---|---|---|
| Existing field | S | Leave unchanged | Leave unchanged |
| Maternity Leave Recorded (Calendar Days) | T | 0 if no prior recorded maternity | 0 if no prior recorded maternity |
| Maternity Eligible (YES/NO) | U | YES | NO |

**YES and NO belong in U—not T.** T must remain numeric. Do not reset already recorded T totals when adding the eligibility flag. A NO flag removes the option for new requests but does not delete historical records.

After the final code is deployed, eligible employees see Annual, Sick, Hajj and Maternity. NO/blank employees see only Annual, Sick and Hajj. Their other leave types and balances are unaffected. Merely hiding a dropdown is not the only safeguard: the server also re-checks current eligibility before final submission, forwarding proof, approval/acknowledgement and updating T. An old form does not bypass this rule, and manager/admin status does not override it.

If HR changes YES to NO while a maternity request is pending, it cannot proceed until HR reconciles that request and verifies the correct eligibility. Do not make random status changes or create a duplicate. If the flag was wrong, HR can correct it and then continue the existing appropriate step.

## Step 2 — Add the delivery-date fields to Leave Requests

1. Click the **Leave Requests** tab at the bottom.
2. Keep **A through N** in their current positions. They include the existing leave details and approval history.
3. Confirm **O, P and Q** are unused. If they already have different data, stop and tell me.
4. Click **O1** and type:

   ```text
   Delivery Date
   ```

5. Click **P1** and type:

   ```text
   Calendar Return Date
   ```

6. Click **Q1** and type:

   ```text
   Day Count Basis
   ```

7. Select columns **O and P** and choose **Format → Number → Plain text**. The app saves dates in `YYYY-MM-DD` form.
8. Leave the cells below these new headers blank. The app fills them for new requests.

The existing **G — Total Days** column remains. For Maternity, G contains **calendar days**, while Q says `Calendar`. For Annual, Sick and Hajj, the existing working-day calculation remains and Q says `Working` for new requests. Do not combine these two day bases as if they were all working days.

Old request rows can keep O:Q blank; you do not need to backfill them manually. Do not change the separate **Performance Reviews** tab for this maternity update.

## Step 3 — Upload the newest complete code package

Use the new package:

```text
SLACK_HR_APP_MATERNITY_ELIGIBILITY_FINAL.zip
```

1. Download and extract the ZIP on your computer.
2. Sign in to GitHub.
3. Open <https://github.com/123admin345/hr-app>.
4. Select the `main` branch and stay on the main repository page.
5. Click **Add file → Upload files**.
6. Drag the contents of the extracted package into GitHub, preserving the folder paths:

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

7. Upload the contents, **not the ZIP itself**, and not an outer folder that nests the entire app inside another directory.
8. Include **assets**; the annual-review PDF printing feature needs its fonts.
9. Commit with the message:

   ```text
   Add maternity leave with private delivery-date proof
   ```

Never upload `.env`, Slack tokens, Google service-account credentials or `node_modules`.

This is a complete app package, not just maternity files. It retains the existing annual-review PDF printing code, annual/sick/Hajj leave, cancellation, approval and acknowledgement routes, visa, performance and new-hire code. It does not add the separately discussed alternative two-level second-approver configuration; the existing two-level acknowledgement route is unchanged.

## Step 4 — Deploy in Render

1. Open Render and choose the existing **hr-app** service.
2. Open **Deploys**.
3. Click **Manual Deploy → Deploy latest commit** after your full GitHub upload finishes.
4. Keep the existing build command (`npm install` or `npm ci`) and start command (`npm start`).
5. Wait for green **Live**.

No new maternity environment variable is required. **Do not create `/request-maternity-leave`.** Employees use the existing `/request-leave` command and select Maternity.

The private upload uses the same Slack messages and permissions already used by Sick/Hajj documents. If employees cannot attach a file in HR System's private Messages tab, check the existing app's messaging/upload setup; this cannot be fixed by posting a confidential document in a public channel.

## Step 5 — What the employee does

1. Open the private **HR System** conversation in Slack.
2. Type:

   ```text
   /request-leave
   ```

3. If HR has marked your row **YES** in U, choose **Maternity Leave** from the leave-type list. It does not appear for NO/blank employees. The form changes to show **Actual Delivery Date**.
4. Select the real delivery date. An estimated future due date is not accepted in this post-delivery form; pre-delivery arrangements must go through HR separately.
5. Add optional notes if needed.
6. Click **Review Request**.
7. Check the delivery/start date, calculated last leave day, calendar return date and total calendar days.
8. Click **Confirm + Submit**.
9. The bot sends a private message asking for **delivery-date proof**.
10. Upload a **PDF or clear image** in that same private chat. Suitable examples are an official delivery certificate, hospital birth notification or another official document clearly showing the actual delivery date.

Provide only the information needed to support the date and request. Do not post the document in `#general`, `#social` or a public channel, and do not paste a public download link. Existing Slack file-access/retention and HR Sheet permissions apply.

Until proof is received, the request stays **Pending Documents**. No approval request is sent and no counter is increased. The app checks receipt of a PDF/image; it does **not** read or medically verify the document. The assigned reviewer must check that the actual date on it matches the entered date. If a reviewer cannot open the private file, HR must resolve the file permissions without making it public.

The same delivery date cannot knowingly be submitted again while its maternity request is already recorded. If the employee accidentally submits it twice, they should continue with the existing request, not create a replacement. An unresolved document upload for another leave request must be completed or resolved by HR first.

## Step 6 — Approval and acknowledgement

Maternity follows the employee's **existing configured leave route**:

- Standard route: manager approval.
- `2-Level`: direct-manager approval, then final acknowledgement.
- `3-Level`: direct-manager approval, department-head approval, then final acknowledgement.

Each assigned person receives the request privately, with earlier approval history where applicable. The request shows that its duration is calendar days, the calculated return date and the supporting document link. Managers must verify the proof, and HR must handle discrepancies or statutory cases rather than treating the app's fixed schedule as the only permitted entitlement.

Only the **final required step** updates column T. At final confirmation, the employee gets a private confirmation and the existing HR channel receives the summary. The HR channel summary does **not** include the proof link. There is no maternity/leave announcement to `#general` or `#social`.

The existing single-use decision protection remains: a processed button is replaced with status, and repeating that same request action does not add the maternity days again.

## Step 7 — Check the result

After one properly authorised maternity request finishes:

1. In **Leave Requests**, check that the type is `Maternity`, the final status is `Approved`, and the supporting-document link is saved in the existing attachment column J.
2. Check delivery date O, calendar return date P and `Calendar` in Q.
3. In **Employee Balances**, verify that only the employee's maternity counter T increased; annual used E, annual remaining F, sick G and Hajj H should be unchanged by this request.
4. The employee can run `/my-balance` to see **Maternity Leave Recorded** separately.
5. Authorised admins can see the maternity counter in `/hr-balance`, and it is included in the existing monthly HR leave report.

Use a controlled, clearly identified HR test case or the next legitimate eligible request for the live check. Do not create an unlabelled fictional childbirth record for a real employee. If a test case was fully confirmed, HR must reverse only its test maternity amount and retain the appropriate test audit; do not alter annual balances.

## Corrections and interruptions

Maternity starts on an actual delivery date—normally today or earlier—so it is **not available for employee self-cancellation through `/cancel-leave`** once it has started. Wrong dates, partial changes, extensions and reversals must go through HR. This update does not add a new HR correction command. Do not simply change a status or column T without reconciling the full request and counter.

A saved **Pending Documents** request can accept its proof after a Render restart. If more than one request is waiting for documents, the app will ask HR to resolve the ambiguity rather than attach the file to an arbitrary request. If an upload or approval stops halfway and a status such as `Document Processing` or `Approval Needs HR Review` remains, contact HR/admin to reconcile it; do not keep submitting or approving new copies.

If proof is saved but an approval notification fails, the bot asks the employee to contact HR using the **existing Request ID**. The Sheet record must be checked before retrying. Do not send tokens or medical documents in troubleshooting screenshots.

Existing Render Free sleep limitations still apply. This update does not guarantee monthly cron reports run while the service is asleep.

## References

[1]: https://www.hrsd.gov.sa/en/knowledge-centre/articles/64410 "HRSD Women's Leaves and Article 151 maternity provisions"

## Verification completed before packaging

All **157 automated tests passed** for this update, including the real maternity handler with mocked Slack/Sheets calls: delivery-date calculation, month-end and leap dates, private-only proof, blocked approval without proof, Pending Documents recovery after restart, duplicate proof events, repeated approvals, two-level final acknowledgement, no annual deduction, exact new column positions, existing annual/sick/Hajj paths, balance displays, PDF export and other existing regression checks. All JavaScript source syntax checks also passed.

Eligibility tests cover NO/blank restrictions, default-safe and eligible-only menus, old-form bypass prevention, changes before proof/approval/final acknowledgement, and preserving annual leave access. These are local automated checks, not confirmation that your GitHub upload or live Slack/Render deployment is already complete. The code and headers must still be installed, and a controlled live check must confirm the existing Slack permissions and file access in your workspace.

## Final live eligibility check

After adding U and deploying this exact final package, ask one employee whose row is marked NO to open a fresh `/request-leave` form. The list must contain Annual, Sick and Hajj only. Ask one employee marked YES to open a fresh form; Maternity should also be present. This menu-only check submits no leave request. Close any forms opened before deployment and open new ones.

If everyone still sees Maternity, the old app version may be running: check that GitHub contains the final files and that Render deployed the latest complete commit. If an eligible employee cannot see it, check their Slack ID row and U=YES rather than changing T or the leave route. No new Slack command or new environment variable is required.
