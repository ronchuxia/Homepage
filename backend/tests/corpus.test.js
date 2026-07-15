import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CorpusError,
  buildCitation,
  resolveScopeRoots,
  safeRelPath,
  sourceForPath,
} from '../src/corpus.js';

const sources = [
  {
    id: 'notes',
    type: 'note',
    root: 'notes',
    citation: { kind: 'notes-slug', base: '/notes/' },
  },
  {
    id: 'workspace',
    type: 'github_repo',
    root: 'github/workspace',
    citation: {
      kind: 'github-blob',
      repo: 'owner/workspace',
      sha: 'abc123',
    },
  },
  {
    id: 'resume',
    type: 'resume',
    root: 'profile',
    citation: { kind: 'none' },
  },
];

test('safeRelPath normalizes paths inside the corpus', () => {
  assert.equal(safeRelPath('/notes/Robotics/Overview.md'), 'notes/Robotics/Overview.md');
  assert.equal(safeRelPath('github/workspace/src/main.js'), 'github/workspace/src/main.js');
});

test('safeRelPath rejects missing, invalid, and escaping paths', () => {
  assert.throws(() => safeRelPath(), CorpusError);
  assert.throws(() => safeRelPath('notes/invalid\0name.md'), CorpusError);
  assert.throws(() => safeRelPath('../outside.txt'), /path escapes the corpus/);
});

test('resolveScopeRoots selects source groups and source identifiers', () => {
  assert.deepEqual(resolveScopeRoots('all', sources), [
    'notes',
    'github/workspace',
    'profile',
  ]);
  assert.deepEqual(resolveScopeRoots('notes', sources), ['notes']);
  assert.deepEqual(resolveScopeRoots('github', sources), ['github/workspace']);
  assert.deepEqual(resolveScopeRoots('profile', sources), ['profile']);
  assert.deepEqual(resolveScopeRoots('workspace', sources), ['github/workspace']);
  assert.deepEqual(resolveScopeRoots('missing', sources), []);
});

test('sourceForPath chooses the longest matching source root', () => {
  const nestedSources = [
    ...sources,
    {
      id: 'nested',
      type: 'github_repo',
      root: 'github/workspace/packages/app',
      citation: { kind: 'none' },
    },
  ];

  assert.equal(
    sourceForPath('github/workspace/packages/app/index.js', nestedSources)?.id,
    'nested',
  );
  assert.equal(sourceForPath('unknown/file.txt', nestedSources), null);
});

test('buildCitation creates internal note links', () => {
  assert.deepEqual(buildCitation('notes/Robotics/Planning.md', sources), {
    source: 'Robotics',
    title: 'Planning',
    type: 'note',
    url: '/notes/Robotics/Planning',
    path: 'notes/Robotics/Planning.md',
  });
});

test('buildCitation creates GitHub line links', () => {
  assert.deepEqual(
    buildCitation('github/workspace/src/main.js', sources, {
      startLine: 12,
      endLine: 18,
    }),
    {
      source: 'workspace',
      title: 'src/main.js',
      type: 'code',
      url: 'https://github.com/owner/workspace/blob/abc123/src/main.js#L12-L18',
      path: 'github/workspace/src/main.js',
    },
  );
});
