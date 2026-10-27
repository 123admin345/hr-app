// Slack section-text blocks allow at most 3,000 characters. Keep below that
// limit so lengthy confidential annual-review summaries can be delivered safely.
const SAFE_SECTION_TEXT_LENGTH = 2800;

function splitSlackSectionText(text, maxLength = SAFE_SECTION_TEXT_LENGTH) {
  const source = String(text || '—').trim() || '—';
  if (source.length <= maxLength) return [source];

  const chunks = [];
  let current = '';
  const paragraphs = source.split(/\n\n/);

  function pushCurrent() {
    if (current) chunks.push(current);
    current = '';
  }

  function appendPiece(piece) {
    if (!current) {
      current = piece;
    } else if (current.length + 2 + piece.length <= maxLength) {
      current = `${current}\n\n${piece}`;
    } else {
      pushCurrent();
      current = piece;
    }
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      appendPiece(paragraph);
      continue;
    }

    const lines = paragraph.split('\n');
    for (const line of lines) {
      if (line.length <= maxLength) {
        appendPiece(line);
        continue;
      }

      let remaining = line;
      while (remaining.length > maxLength) {
        if (current) pushCurrent();
        chunks.push(remaining.slice(0, maxLength));
        remaining = remaining.slice(maxLength);
      }
      if (remaining) appendPiece(remaining);
    }
  }
  pushCurrent();
  return chunks;
}

function markdownSectionBlocks(text, maxLength = SAFE_SECTION_TEXT_LENGTH) {
  return splitSlackSectionText(text, maxLength).map((chunk) => ({
    type: 'section',
    text: { type: 'mrkdwn', text: chunk },
  }));
}

module.exports = {
  SAFE_SECTION_TEXT_LENGTH,
  splitSlackSectionText,
  markdownSectionBlocks,
};
