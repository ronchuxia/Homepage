import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { CORPUS_ROOT } from '../src/corpus.js';
import {
  clamp,
  parseRgMatches,
} from '../src/tools/shared.js';

test('clamp applies bounds and a fallback', () => {
  assert.equal(clamp(undefined, 1, 50, 20), 20);
  assert.equal(clamp(0, 1, 50, 20), 1);
  assert.equal(clamp(75, 1, 50, 20), 50);
  assert.equal(clamp(12.9, 1, 50, 20), 12);
});

test('parseRgMatches extracts valid matches and ignores other lines', () => {
  const absolutePath = path.join(CORPUS_ROOT, 'notes', 'Example.md');
  const match = JSON.stringify({
    type: 'match',
    data: {
      path: { text: absolutePath },
      lines: { text: 'matching text\n' },
      line_number: 7,
    },
  });
  const context = JSON.stringify({ type: 'context', data: {} });

  assert.deepEqual(parseRgMatches(`${match}\n${context}\ninvalid json\n`), [
    {
      relPath: 'notes/Example.md',
      line: 7,
      text: 'matching text',
    },
  ]);
});
