// read_file(path, start_line, line_count): a bounded window of a file.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildCitation,
  CORPUS_ROOT,
  loadSources,
  safeRelPath,
  validateSearchPath,
} from '../corpus.js';
import { DEFAULT_READ_LINES, MAX_READ_LINES, clamp } from './shared.js';

export async function readFileWindow({ path: filePath, startLine, lineCount } = {}) {
  const relPath = safeRelPath(filePath);
  const sources = await loadSources();
  validateSearchPath(relPath, sources);

  const abs = path.join(CORPUS_ROOT, relPath);
  const content = await readFile(abs, 'utf8');
  const allLines = content.split('\n');

  const start = clamp(startLine, 1, Math.max(1, allLines.length), 1);
  const count = clamp(lineCount, 1, MAX_READ_LINES, DEFAULT_READ_LINES);
  const slice = allLines.slice(start - 1, start - 1 + count);
  const end = start + slice.length - 1;
  return {
    path: relPath,
    startLine: start,
    endLine: end,
    totalLines: allLines.length,
    content: slice.join('\n'),
    citation: buildCitation(relPath, sources, { startLine: start, endLine: end }),
  };
}
