// list_sources(scope): what is searchable, by source.
//
// Without a scope, summarizes every source; a source id also lists that
// source's file paths.

import { existsSync } from 'node:fs';
import path from 'node:path';

import { CORPUS_ROOT, loadSources, resolveScopeSources } from '../corpus.js';
import { rgCorpusFlags, runRg } from './shared.js';

export async function listSources({ scope } = {}) {
  const sources = await loadSources();
  const selected = resolveScopeSources(scope, sources);

  const result = [];
  for (const source of selected) {
    const entry = {
      id: source.id,
      type: source.type,
      root: source.root,
    };
    if (scope) {
      const abs = path.join(CORPUS_ROOT, source.root);
      let filePaths = [];
      if (existsSync(abs)) {
        const listing = await runRg(['--files', ...rgCorpusFlags, '--', abs]);
        filePaths = listing
          ? listing.trimEnd().split('\n').map((p) => path.relative(CORPUS_ROOT, p))
          : [];
      }
      entry.files = filePaths;
    }
    result.push(entry);
  }
  return result;
}
