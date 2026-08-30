import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCitation,
  resolveScopeSources,
  safeRelPath,
  sourceForPath,
} from '../src/corpus.js';

const sources = [
  {
    id: 'notes',
    type: 'notes',
    root: 'search/notes',
    citation: { base: '/notes' },
  },
  {
    id: 'workspace',
    type: 'github',
    root: 'search/github/workspace',
    citation: {
      base: 'https://github.com/owner/workspace/blob/abc123',
    },
  },
  {
    id: 'profile/resume',
    type: 'materials',
    root: 'search/materials/profile/resume',
    citation: {
      base: 'https://api.example.com/api/materials/profile/resume.pdf',
    },
  },
  {
    id: 'portfolio',
    type: 'websites',
    root: 'search/websites/portfolio',
    citation: { base: 'https://example.com/projects' },
  },
];

test('safeRelPath normalizes relative paths inside the corpus', () => {
  assert.equal(safeRelPath('search/notes/Robotics/Overview.md'), 'search/notes/Robotics/Overview.md');
  assert.equal(safeRelPath('search/github/workspace/src/main.js'), 'search/github/workspace/src/main.js');
});

test('safeRelPath rejects missing, absolute, invalid, and escaping paths', () => {
  assert.throws(() => safeRelPath(), /path is required/);
  assert.throws(() => safeRelPath('/search/notes/Robotics/Overview.md'), /path must be relative/);
  assert.throws(() => safeRelPath('notes/invalid\0name.md'), /path is invalid/);
  assert.throws(() => safeRelPath('../outside.txt'), /path escapes the corpus/);
});

test('resolveScopeSources selects every source without a scope, one source by id', () => {
  assert.deepEqual(resolveScopeSources(undefined, sources), sources);
  assert.deepEqual(resolveScopeSources('notes', sources), [sources[0]]);
  assert.deepEqual(resolveScopeSources('workspace', sources), [sources[1]]);
  assert.deepEqual(resolveScopeSources('profile/resume', sources), [sources[2]]);
});

test('resolveScopeSources rejects unknown scopes', () => {
  assert.throws(() => resolveScopeSources('missing', sources), /unknown scope/);
  assert.throws(() => resolveScopeSources('all', sources), /unknown scope/);
  assert.throws(() => resolveScopeSources('github', sources), /unknown scope/);
  assert.throws(() => resolveScopeSources('search/github/workspace/src', sources), /unknown scope/);
});

test('sourceForPath chooses the longest matching source root', () => {
  const nestedSources = [
    ...sources,
    {
      id: 'nested',
      type: 'github',
      root: 'search/github/workspace/packages/app',
      citation: {},
    },
  ];

  assert.equal(
    sourceForPath('search/github/workspace/packages/app/index.js', nestedSources)?.id,
    'nested',
  );
  assert.equal(sourceForPath('unknown/file.txt', nestedSources), null);
});

test('buildCitation creates internal note links', () => {
  assert.deepEqual(buildCitation('search/notes/Robotics/Planning.md', sources), {
    source: 'Robotics',
    title: 'Planning',
    type: 'notes',
    url: '/notes/Robotics/Planning',
    path: 'search/notes/Robotics/Planning.md',
  });
});

test('buildCitation creates GitHub line links', () => {
  assert.deepEqual(
    buildCitation('search/github/workspace/src/main.js', sources, {
      startLine: 12,
      endLine: 18,
    }),
    {
      source: 'workspace',
      title: 'src/main.js',
      type: 'github',
      url: 'https://github.com/owner/workspace/blob/abc123/src/main.js#L12-L18',
      path: 'search/github/workspace/src/main.js',
    },
  );
});

test('buildCitation creates PDF page links', () => {
  assert.deepEqual(
    buildCitation('search/materials/profile/resume/pages/page-0002.txt', sources),
    {
      source: 'profile',
      title: 'resume.pdf',
      type: 'materials',
      url: 'https://api.example.com/api/materials/profile/resume.pdf#page=2',
      path: 'search/materials/profile/resume/pages/page-0002.txt',
    },
  );
});

test('buildCitation creates live website links', () => {
  assert.deepEqual(
    buildCitation('search/websites/portfolio/demo/index.html', sources),
    {
      source: 'portfolio',
      title: 'index',
      type: 'websites',
      url: 'https://example.com/projects/demo/',
      path: 'search/websites/portfolio/demo/index.html',
    },
  );
});
