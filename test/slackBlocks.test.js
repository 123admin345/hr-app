const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SAFE_SECTION_TEXT_LENGTH,
  splitSlackSectionText,
  markdownSectionBlocks,
} = require('../src/utils/slackBlocks');

test('splits long annual-review summaries into Slack-safe section text', () => {
  const longSummary = `${'A'.repeat(1600)}\n\n${'B'.repeat(1600)}\n\n${'C'.repeat(1600)}`;
  const chunks = splitSlackSectionText(longSummary);
  const blocks = markdownSectionBlocks(longSummary);

  assert.ok(chunks.length > 1);
  assert.equal(chunks.join('\n\n'), longSummary);
  assert.ok(chunks.every((chunk) => chunk.length <= SAFE_SECTION_TEXT_LENGTH));
  assert.ok(blocks.every((block) => block.type === 'section' && block.text.type === 'mrkdwn'));
  assert.ok(blocks.every((block) => block.text.text.length <= SAFE_SECTION_TEXT_LENGTH));
});

test('keeps a normal discussion summary in one Slack section', () => {
  const summary = '*Employee Assessment*\nCompleted all annual-review fields.';
  assert.deepEqual(splitSlackSectionText(summary), [summary]);
  assert.equal(markdownSectionBlocks(summary).length, 1);
});
