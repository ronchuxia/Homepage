// search_corpus(query, scope, limit): grep across the in-scope sources.

import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  CORPUS_ROOT,
  buildCitation,
  loadSources,
  resolveScopeRoots,
} from '../corpus.js';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clamp,
  parseRgMatches,
  rgSearchFlags,
  runRg,
} from './shared.js';

export async function searchCorpus({
  query,
  scope = 'all',
  limit,
} = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('query is required');
  }
  const cap = clamp(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);

  const sources = await loadSources();
  const dirs = resolveScopeRoots(scope, sources)
    .map((root) => path.join(CORPUS_ROOT, root))
    .filter((abs) => existsSync(abs));

  if (dirs.length === 0) {
    return { hits: [], truncated: false };
  }

  const stdout = await runRg([...rgSearchFlags, '-e', query, '--', ...dirs]);
  const matches = parseRgMatches(stdout);
  const truncated = matches.length > cap;

  const hits = matches.slice(0, cap).map((match) => ({
    path: match.relPath,
    line: match.line,
    text: match.text,
    citation: buildCitation(match.relPath, sources, {
      startLine: match.line,
      endLine: match.line,
    }),
  }));
  return { hits, truncated };
}
