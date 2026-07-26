// Corpus location, path sandboxing, source registry, and citation building.
//
// Every file access in the search tools goes through here so that a path
// supplied by a caller (and later, by the model) can never escape /corpus.

import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const CORPUS_ROOT = path.resolve(here, '..', 'corpus');

export class CorpusError extends Error {}

// Normalize a caller-supplied path to a safe POSIX-relative path inside the
// corpus. Rejects NUL bytes and any `..` segment that escapes the root.
// Absolute inputs are treated as corpus-relative (leading slashes stripped).
export function safeRelPath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new CorpusError('a path is required');
  }
  if (input.includes('\0')) {
    throw new CorpusError('invalid path');
  }

  const cleaned = input.replace(/^[/\\]+/, '');
  const abs = path.resolve(CORPUS_ROOT, cleaned);
  const rel = path.relative(CORPUS_ROOT, abs);

  if (rel === '') {
    return ''; // the corpus root itself (used for listing)
  }
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new CorpusError('path escapes the corpus');
  }

  return rel.split(path.sep).join('/');
}

// Resolve to an absolute path and verify, via realpath, that symlinks do not
// escape the corpus. Use for paths that must already exist (read/search a file).
export async function toAbsoluteExisting(input) {
  const rel = safeRelPath(input);
  const abs = path.join(CORPUS_ROOT, rel);

  let real;
  try {
    real = await realpath(abs);
  } catch {
    throw new CorpusError('not found');
  }

  const realRoot = await realpath(CORPUS_ROOT);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new CorpusError('path escapes the corpus');
  }
  return abs;
}

export function toRelative(absPath) {
  return path.relative(CORPUS_ROOT, absPath).split(path.sep).join('/');
}

let cachedSources = null;

export async function loadSources() {
  if (!cachedSources) {
    const raw = await readFile(path.join(CORPUS_ROOT, 'sources.json'), 'utf8');
    cachedSources = JSON.parse(raw).sources;
  }
  return cachedSources;
}

// Map a request scope to the corpus-relative roots to search. A scope can be
// "all", a source-type group ("notes" | "github"), or a source id.
export function resolveScopeRoots(scope, sources) {
  if (!scope || scope === 'all') {
    return sources.map((source) => source.root);
  }
  if (scope === 'notes') {
    return sources.filter((s) => s.type === 'notes').map((s) => s.root);
  }
  if (scope === 'github') {
    return sources.filter((s) => s.type === 'github').map((s) => s.root);
  }
  return sources.filter((s) => s.id === scope).map((s) => s.root);
}

// The source whose root is the longest matching prefix of a corpus path.
export function sourceForPath(relPath, sources) {
  let best = null;
  for (const source of sources) {
    if (relPath === source.root || relPath.startsWith(`${source.root}/`)) {
      if (!best || source.root.length > best.root.length) {
        best = source;
      }
    }
  }
  return best;
}

// Build a display citation for a hit, using the owning source's citation rule.
export function buildCitation(relPath, sources, range = {}) {
  const source = sourceForPath(relPath, sources);
  const name = relPath.split('/').pop();

  if (!source) {
    return { source: null, title: name, url: null, path: relPath };
  }

  const citation = source.citation;

  if (source.type === 'notes') {
    const slug = relPath.slice(source.root.length + 1).replace(/\.md$/, '');
    const parts = slug.split('/');
    return {
      source: parts.length > 1 ? parts[0] : 'Notes',
      title: parts.at(-1),
      type: source.type,
      url: `${citation.base}${slug}`,
      path: relPath,
    };
  }

  if (source.type === 'github') {
    const sub = relPath.slice(source.root.length + 1);
    let fragment = '';
    if (range.startLine) {
      fragment =
        range.endLine && range.endLine !== range.startLine
          ? `#L${range.startLine}-L${range.endLine}`
          : `#L${range.startLine}`;
    }
    return {
      source: citation.repo.split('/').at(-1),
      title: sub,
      type: source.type,
      url: `https://github.com/${citation.repo}/blob/${citation.sha}/${sub}${fragment}`,
      path: relPath,
    };
  }

  return { source: source.id, title: name, type: source.type, url: null, path: relPath };
}
