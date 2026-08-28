import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { CORPUS_ROOT } from '../src/corpus.js';
import {
  clamp,
  filterPathMatches,
  parseRgMatches,
  rankMatches,
  rankPathMatches,
  tokenizeQuery,
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

test('tokenizeQuery splits on whitespace and keeps quoted phrases whole', () => {
  assert.deepEqual(tokenizeQuery('robot slam'), ['robot', 'slam']);
  assert.deepEqual(tokenizeQuery('"pure pursuit" raceline'), ['pure pursuit', 'raceline']);
  assert.deepEqual(tokenizeQuery('   '), []);
});

test('rankMatches ranks files by keyword coverage, then by match count', () => {
  const matches = [
    { relPath: 'a.md', line: 1, text: 'alpha' },
    { relPath: 'a.md', line: 2, text: 'alpha again' },
    { relPath: 'a.md', line: 3, text: 'alpha third' },
    { relPath: 'b.md', line: 1, text: 'Alpha and BETA' },
    { relPath: 'c.md', line: 1, text: 'beta' },
    { relPath: 'c.md', line: 2, text: 'beta two' },
  ];
  assert.deepEqual(
    rankMatches(matches, ['alpha', 'beta']).map((m) => `${m.relPath}:${m.line}`),
    ['b.md:1', 'a.md:1', 'a.md:2', 'a.md:3', 'c.md:1', 'c.md:2'],
  );
});

test('filterPathMatches keeps only paths containing a keyword, case-insensitively', () => {
  const paths = ['github/RayTracerCUDA/src/scene.h', 'notes/SLAM.md'];
  assert.deepEqual(filterPathMatches(paths, ['raytracercuda']), [
    'github/RayTracerCUDA/src/scene.h',
  ]);
  assert.deepEqual(filterPathMatches(paths, ['missing']), []);
});

test('rankPathMatches orders paths by keyword coverage', () => {
  const paths = ['a/beta.md', 'b/alpha-beta.md'];
  assert.deepEqual(rankPathMatches(paths, ['alpha', 'beta']), [
    'b/alpha-beta.md',
    'a/beta.md',
  ]);
});
