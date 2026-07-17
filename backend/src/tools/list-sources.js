// list_sources(scope): what is searchable, by source.

import { existsSync } from 'node:fs';
import path from 'node:path';

import { CORPUS_ROOT, loadSources, resolveScopeRoots } from '../corpus.js';
import { rgCorpusFlags, runRg, visibleSources } from './shared.js';

export async function listSources({ scope = 'all', includePrivate = false } = {}) {
  const sources = visibleSources(await loadSources(), includePrivate);
  const roots = new Set(resolveScopeRoots(scope, sources));
  const selected = sources.filter((source) => roots.has(source.root));

  const result = [];
  for (const source of selected) {
    const abs = path.join(CORPUS_ROOT, source.root);
    let fileCount = 0;
    if (existsSync(abs)) {
      const listing = await runRg(['--files', ...rgCorpusFlags, abs]);
      fileCount = listing ? listing.trimEnd().split('\n').length : 0;
    }
    result.push({
      id: source.id,
      type: source.type,
      visibility: source.visibility,
      root: source.root,
      fileCount,
    });
  }
  return result;
}
