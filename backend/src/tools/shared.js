// Shared internals for the corpus search tools: ripgrep invocation, output
// parsing, and bounds clamping. No model is involved — these back the
// pure-retrieval tools in this directory.

import { execFile } from 'node:child_process';
import path from 'node:path';

import { CORPUS_ROOT } from '../corpus.js';

const RG = process.env.RG_PATH || 'rg';

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const DEFAULT_READ_LINES = 80;
export const MAX_READ_LINES = 400;
const MAX_LINE_CHARS = 300;
const RG_TIMEOUT_MS = 5000;
const RG_MAX_BYTES = 4_000_000;

export function clamp(value, min, max, fallback) {
  const n = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

// Run ripgrep with bounded time/output. ripgrep exits 1 when there are simply
// no matches, which is not an error here.
export function runRg(args) {
  return new Promise((resolve, reject) => {
    execFile(
      RG,
      args,
      { timeout: RG_TIMEOUT_MS, maxBuffer: RG_MAX_BYTES, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) return reject(new Error('search timed out'));
          if (error.code === 1) return resolve(''); // no matches
          return reject(new Error(stderr?.trim() || error.message));
        }
        return resolve(stdout);
      },
    );
  });
}

export function parseRgMatches(stdout) {
  const matches = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== 'match') continue;

    const data = event.data;
    const absPath = data.path?.text;
    if (!absPath) continue; // non-UTF8 path: skip

    const raw = (data.lines?.text ?? '').replace(/\n$/, '');
    const text =
      raw.length > MAX_LINE_CHARS ? `${raw.slice(0, MAX_LINE_CHARS)}…` : raw;

    matches.push({
      relPath: path.relative(CORPUS_ROOT, absPath),
      line: data.line_number,
      text,
    });
  }
  return matches;
}

// The corpus is our own vetted text, so search all of it: --hidden includes
// dotfiles (e.g. .github/), and --no-ignore stops any stray .gitignore copied
// from a repo from silently excluding files. (ripgrep still skips binaries.)
export const rgCorpusFlags = ['--hidden', '--no-ignore'];

export const rgSearchFlags = [
  '--json',
  '--smart-case',
  '--max-columns',
  '500',
  '--max-columns-preview',
  ...rgCorpusFlags,
];
