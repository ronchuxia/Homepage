// search_corpus(query, scope, limit): grep across the in-scope sources.
//
// The query is split into keywords (double-quoted spans stay whole) OR'd into
// one ripgrep call. Content matches are ranked by keyword coverage per file,
// tie-broken by match count. Keywords are also matched against corpus-relative
// file paths, returned separately as `pathHits`.

import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  CORPUS_ROOT,
  buildCitation,
  loadSources,
  resolveScopeSources,
} from '../corpus.js';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clamp,
  filterPathMatches,
  parseRgMatches,
  rankMatches,
  rankPathMatches,
  rgCorpusFlags,
  rgSearchFlags,
  runRg,
  tokenizeQuery,
} from './shared.js';

const EMPTY_HINT =
  'Nothing matched in file contents or filenames. Try fewer or different ' +
  'keywords, or call list_sources to see what the corpus contains.';

const TRUNCATED_HINT =
  'Results were truncated. Narrow the search by setting scope to a source id ' +
  'from list_sources, wrapping a multi-word phrase in double quotes to match ' +
  'it exactly, raising the limit, or searching for fewer keywords.';

export async function searchCorpus({
  query,
  scope,
  limit,
} = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('query is required');
  }
  const keywords = tokenizeQuery(query);
  if (keywords.length === 0) {
    throw new Error('query is required');
  }
  const cap = clamp(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);

  const sources = await loadSources();
  const targets = resolveScopeSources(scope, sources)
    .map((source) => path.join(CORPUS_ROOT, source.root))
    .filter((abs) => existsSync(abs));

  if (targets.length === 0) {
    return { contentHits: [], pathHits: [], truncated: false, hint: EMPTY_HINT };
  }

  const patterns = keywords.flatMap((keyword) => ['-e', keyword]);
  const stdout = await runRg([...rgSearchFlags, ...patterns, '--', ...targets]);
  const parsedMatches = parseRgMatches(stdout);
  const rankedMatches = rankMatches(parsedMatches, keywords);

  const contentHits = rankedMatches.slice(0, cap).map((match) => ({
    path: match.relPath,
    line: match.line,
    text: match.text,
    citation: buildCitation(match.relPath, sources, {
      startLine: match.line,
      endLine: match.line,
    }),
  }));

  const listing = await runRg(['--files', ...rgCorpusFlags, '--', ...targets]);
  const allPaths = listing
    ? listing.trimEnd().split('\n').map((abs) => path.relative(CORPUS_ROOT, abs))
    : [];
  const contentHitPaths = new Set(contentHits.map((hit) => hit.path));
  const matchedPaths = filterPathMatches(allPaths, keywords);
  const pathHitPaths = rankPathMatches(matchedPaths, keywords);
  const pathMatches = pathHitPaths.filter(
    (relPath) => !contentHitPaths.has(relPath),
  );
  const pathHits = pathMatches.slice(0, cap);

  if (contentHits.length === 0 && pathHits.length === 0) {
    return { contentHits: [], pathHits: [], truncated: false, hint: EMPTY_HINT };
  }
  const truncated = rankedMatches.length > cap || pathMatches.length > cap;
  return {
    contentHits,
    pathHits,
    truncated,
    ...(truncated ? { hint: TRUNCATED_HINT } : {}),
  };
}
