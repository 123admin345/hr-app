const { isPerformanceHrUser } = require('../utils/hrAuthorization');
const { isAnnualFramework } = require('../utils/saudiHtcPerformance');

const EXPORT_STATUSES = new Set(['Completed', 'Awaiting Employee Signature']);
const activeExports = new Set();

function canPrintAnnualReview(review) {
  return Boolean(review && typeof review.caseId === 'string' && /^PERF-[A-Za-z0-9_-]{1,70}$/.test(review.caseId)
    && isAnnualFramework(review) && EXPORT_STATUSES.has(review.status)
    && review.managerScores?.finalAssessment?.managerSignature);
}

function printableAnnualReviews(reviews = []) {
  return reviews.filter(canPrintAnnualReview).sort((a, b) =>
    String(b.openedAt || '').localeCompare(String(a.openedAt || ''))
    || String(b.caseId || '').localeCompare(String(a.caseId || '')));
}

function printFilename(review) {
  const safeCase = String(review.caseId || 'review').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
  return `Saudi_HTC_Annual_Review_${safeCase}.pdf`;
}

function loadingPrintModal() {
  return {
    type: 'modal', title: { type: 'plain_text', text: 'Loading Print Options' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Loading submitted annual reviews. The printable PDF will be delivered only to your private HR System chat.' } }],
  };
}

function printSelectionModal(reviews, requesterId) {
  const eligible = printableAnnualReviews(reviews);
  if (!eligible.length) return {
    type: 'modal', title: { type: 'plain_text', text: 'Annual Review PDF' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'No manager-signed annual review is available to print yet. The manager must submit the final Annual Review & Growth Plan first. Do not start a replacement review.' } }],
  };
  return {
    type: 'modal', callback_id: 'annual_review_pdf_submit',
    private_metadata: JSON.stringify({ requesterId }),
    title: { type: 'plain_text', text: 'Annual Review PDF' },
    submit: { type: 'plain_text', text: 'Create PDF' }, close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: 'Select the submitted annual review. The PDF includes all saved sections and blank handwritten signature/date lines. Existing electronic signatures and the review status will not be changed.' } },
      { type: 'input', block_id: 'annual_print_case', label: { type: 'plain_text', text: 'Annual review to print' }, element: {
        type: 'static_select', action_id: 'annual_print_case_select',
        options: eligible.slice(0, 100).map((review) => ({
          text: { type: 'plain_text', text: `${review.employeeName || 'Employee'} | ${review.reviewPeriod || review.openedAt || 'Period not recorded'} | ${review.caseId}`.slice(0, 75) },
          value: review.caseId,
        })),
      } },
      ...(eligible.length > 100 ? [{ type: 'section', text: { type: 'mrkdwn', text: 'Only the 100 most recent submitted reviews are listed. For an older review, use `/download-annual-review PERF-...` with its Case ID from column A of Performance Reviews.' } }] : []),
    ],
  };
}

function printErrorMessage(error) {
  if (error?.data?.error === 'missing_scope') {
    return 'The app needs permission to send your PDF. In the Slack app settings, add Bot Token Scopes `files:write` and `im:write`, reinstall the app, and update SLACK_BOT_TOKEN in Render if it changed. Then try /download-annual-review again. Do not paste the token in a chat.';
  }
  if (error?.code === 'NOT_PRINTABLE') return error.message;
  return 'The PDF could not be created or delivered. Your saved review was not changed. Ask the app administrator to check the latest Render log marked [Annual Review PDF], then try again.';
}

function safeLog(logger, label, error) {
  // Never log the PDF, employee answers, token, or full Slack API payload.
  logger.error(`[Annual Review PDF] ${label}`, { code: error?.data?.error || error?.code || 'export_failed' });
}

function registerAnnualReviewExportHandlers(app, overrides = {}) {
  const sheets = overrides.sheets || require('../utils/sheets');
  const renderPdf = overrides.generatePdf || ((review, options) => require('../utils/annualReviewPdf').generateAnnualReviewPdf(review, options));
  const isHr = overrides.isHr || isPerformanceHrUser;

  async function privateMessage(client, userId, text, blocks) {
    return client.chat.postMessage({ channel: userId, text, ...(blocks ? { blocks } : {}) });
  }

  async function showSelection(client, triggerId, userId) {
    let loading;
    try {
      // Use the short-lived Slack trigger before Google Sheets or PDF work.
      loading = await client.views.open({ trigger_id: triggerId, view: loadingPrintModal() });
      const reviews = await sheets.getAllPerformanceReviews();
      await client.views.update({ view_id: loading.view.id, hash: loading.view.hash, view: printSelectionModal(reviews, userId) });
    } catch (error) {
      if (error?.data?.error === 'expired_trigger_id') {
        await privateMessage(client, userId,
          'The app had to wake up and this click expired. It is ready now. Please click the new Open Print Options button below once.',
          [{ type: 'section', text: { type: 'mrkdwn', text: 'This click expired while the HR app was waking up. Use the fresh button below to choose your annual-review PDF.' } },
            { type: 'actions', elements: [{ type: 'button', action_id: 'open_annual_review_print_options', text: { type: 'plain_text', text: 'Open Print Options' }, value: userId }] }]);
        return;
      }
      if (loading?.view?.id) await client.views.update({ view_id: loading.view.id, view: {
        type: 'modal', title: { type: 'plain_text', text: 'Print Unavailable' }, close: { type: 'plain_text', text: 'Close' },
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: printErrorMessage(error) } }],
      } }).catch(() => {});
      throw error;
    }
  }

  async function sendPdf(client, userId, caseId) {
    // Re-check HR and the current record at export time, not only in the menu.
    if (!isHr(userId)) return privateMessage(client, userId, 'Only authorised HR users can download annual reviews.');
    const key = `${userId}:${caseId}`;
    if (activeExports.has(key)) return privateMessage(client, userId, 'Your PDF is already being prepared. Please wait for the file in this private chat.');
    activeExports.add(key);
    try {
      const review = await sheets.getPerformanceReviewCase(caseId);
      if (!canPrintAnnualReview(review)) {
        const error = new Error('This annual review is not ready to print. It must have the manager’s final form and signature saved. Use the existing case; do not submit a new review.');
        error.code = 'NOT_PRINTABLE';
        throw error;
      }
      await privateMessage(client, userId, 'Preparing your confidential annual-review PDF. It will appear as a file in this private HR System conversation; please do not click again.');
      const profiles = await sheets.getAllEmployees();
      const employee = profiles.find((item) => item.slackUserId === review.employeeSlackId) || {};
      const manager = profiles.find((item) => item.slackUserId === review.managerSlackId);
      const managerName = manager?.name || review.managerScores.finalAssessment.managerSignature || review.managerSlackId;
      const pdf = await renderPdf(review, { employee, managerName });
      if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF output');
      const dm = await client.conversations.open({ users: userId });
      const dmId = dm.channel?.id;
      if (!dmId || !/^D[A-Z0-9]+$/.test(dmId)) throw new Error('A private direct-message channel is required');
      const uploaded = await client.filesUploadV2({
        file: pdf, filename: printFilename(review),
        title: `Annual Review & Growth Plan — ${review.employeeName}`.slice(0, 200),
        channel_id: dmId,
        initial_comment: 'Confidential annual-review print copy. Download the PDF and print all pages on A4. The manager and employee can hand-sign the blank lines in Part 9. Existing electronic signatures and the saved review status have NOT been changed. File the signed original in the employee’s confidential HR record.',
      });
      if (uploaded?.ok === false) throw new Error('Slack did not complete file delivery');
      return uploaded;
    } finally {
      activeExports.delete(key);
    }
  }

  app.command('/download-annual-review', async ({ ack, command, client, logger }) => {
    await ack();
    if (!isHr(command.user_id)) return privateMessage(client, command.user_id, 'Only authorised HR users can download annual reviews.');
    try {
      const caseId = String(command.text || '').trim();
      if (caseId) {
        if (!/^PERF-[A-Za-z0-9_-]{1,70}$/.test(caseId)) return privateMessage(client, command.user_id, 'Use /download-annual-review on its own to select a review, or add its exact Case ID from column A of Performance Reviews: /download-annual-review PERF-...');
        await sendPdf(client, command.user_id, caseId);
      } else await showSelection(client, command.trigger_id, command.user_id);
    } catch (error) {
      safeLog(logger, 'Command failed', error);
      await privateMessage(client, command.user_id, printErrorMessage(error));
    }
  });

  app.action('open_annual_review_print_options', async ({ ack, body, action, client, logger }) => {
    await ack();
    if (!isHr(body.user.id) || action.value !== body.user.id) return privateMessage(client, body.user.id, 'Only the authorised HR recipient can open these print options.');
    try { await showSelection(client, body.trigger_id, body.user.id); }
    catch (error) {
      safeLog(logger, 'Print options failed', error);
      await privateMessage(client, body.user.id, printErrorMessage(error));
    }
  });

  app.view('annual_review_pdf_submit', async ({ ack, body, view, client, logger }) => {
    let requesterId;
    const userId = body?.user?.id;
    try { requesterId = JSON.parse(view?.private_metadata || '{}').requesterId; } catch (_) { requesterId = ''; }
    const caseId = view?.state?.values?.annual_print_case?.annual_print_case_select?.selected_option?.value;
    if (!userId || !isHr(userId) || requesterId !== userId) return ack({ response_action: 'errors', errors: { annual_print_case: 'Only the authorised HR requester can export this review.' } });
    if (!caseId) return ack({ response_action: 'errors', errors: { annual_print_case: 'Please select an annual review.' } });
    // Clear the full modal stack before doing any Sheets, PDF or upload work.
    await ack({ response_action: 'clear' });
    try { await sendPdf(client, userId, caseId); }
    catch (error) {
      safeLog(logger, 'PDF delivery failed', error);
      await privateMessage(client, userId, printErrorMessage(error));
    }
  });
}

module.exports = { registerAnnualReviewExportHandlers, canPrintAnnualReview, printableAnnualReviews, printFilename, printSelectionModal, loadingPrintModal, printErrorMessage };
