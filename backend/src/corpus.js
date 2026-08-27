// Corpus location, path sandboxing, source registry, and citation building.
//
// Every file access in the search tools goes through here so that a path
// supplied by a caller (and later, by the model) can never escape /corpus.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const CORPUS_ROOT = path.resolve(here, '..', 'corpus');

// Normalize a caller-supplied relative path inside a root directory, the
// corpus by default. Reject absolute paths, NUL bytes, and any `..` segment
// that escapes the root.
export function safeRelPath(input, root = CORPUS_ROOT) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('path is required');
  }
  if (input.includes('\0')) {
    throw new Error('path is invalid');
  }
  if (path.isAbsolute(input)) {
    throw new Error('path must be relative');
  }

  const rel = path.relative(root, path.resolve(root, input));

  if (rel === '..' || rel.startsWith('../')) {
    throw new Error('path escapes the corpus');
  }

  return rel;
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
// "all", a source-type group, or a source id.
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
  if (scope === 'materials') {
    return sources.filter((s) => s.type === 'materials').map((s) => s.root);
  }
  if (scope === 'websites') {
    return sources.filter((s) => s.type === 'websites').map((s) => s.root);
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

export function validateSearchPath(relPath, sources) {
  const source = sourceForPath(relPath, sources);
  if (!source) {
    throw new Error('path is not in a search root');
  }
  return source;
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
      url: `${citation.base}/${slug}`,
      path: relPath,
    };
  }

  if (source.type === 'github') {
    const sub = relPath.slice(source.root.length + 1);
    const repositoryName = new URL(citation.base).pathname.split('/')[2];
    let fragment = '';
    if (range.startLine) {
      fragment =
        range.endLine && range.endLine !== range.startLine
          ? `#L${range.startLine}-L${range.endLine}`
          : `#L${range.startLine}`;
    }
    return {
      source: repositoryName,
      title: sub,
      type: source.type,
      url: `${citation.base}/${sub}${fragment}`,
      path: relPath,
    };
  }

  if (source.type === 'materials') {
    const pageNumber = Number(path.basename(relPath, '.txt').slice('page-'.length));
    const materialParts = new URL(citation.base).pathname.slice('/materials/'.length).split('/');
    const materialSource = materialParts.length > 1 ? materialParts[0] : 'Materials';
    const materialTitle = materialParts.at(-1);
    return {
      source: materialSource,
      title: `${materialTitle}`,
      type: source.type,
      url: `${citation.base}#page=${pageNumber}`,
      path: relPath,
    };
  }

  if (source.type === 'websites') {
    const sub = relPath.slice(source.root.length + 1);
    const route = sub.replace(/(^|\/)index\.html$/i, '$1');
    return {
      source: source.id,
      title: name.replace(/\.html?$/i, ''),
      type: source.type,
      url: new URL(route, `${citation.base}/`).toString(),
      path: relPath,
    };
  }

  return { source: source.id, title: name, type: source.type, url: null, path: relPath };
}
