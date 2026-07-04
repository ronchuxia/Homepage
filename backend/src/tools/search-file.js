// search_file(path, query, limit): grep within a single file.

import { toAbsoluteExisting, toRelative } from '../corpus.js';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clamp,
  logTool,
  parseRgMatches,
  rgSearchFlags,
  runRg,
} from './shared.js';

export async function searchFile({ path: filePath, query, limit } = {}) {
  if (!query || typeof query !== 'string') {
    throw new Error('query is required');
  }
  const started = Date.now();
  const cap = clamp(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);

  const abs = await toAbsoluteExisting(filePath);

  const stdout = await runRg([...rgSearchFlags, '-e', query, '--', abs]);
  const matches = parseRgMatches(stdout);
  const truncated = matches.length > cap;

  const hits = matches.slice(0, cap).map((match) => ({
    path: match.relPath,
    line: match.line,
    text: match.text,
  }));

  logTool('search_file', {
    path: toRelative(abs),
    query,
    count: hits.length,
    ms: Date.now() - started,
  });
  return { path: toRelative(abs), hits, truncated };
}
