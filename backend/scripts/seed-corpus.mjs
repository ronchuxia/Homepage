#!/usr/bin/env node
// Build the Phase 2 seed corpus under backend/corpus/.
//
// The layout mirrors the planned real corpus so the search tools and their
// `scope` filtering are exercised against the real shape from the start:
//
//   corpus/
//     notes/<folder>/<note>.md      a subset of the Obsidian vault (../notes)
//     github/<repo>/<source>        filtered clone: source/text only, no binaries
//     sources.json                  source registry for list_sources + citations
//
// Re-runnable: it wipes corpus/ and rebuilds, cloning the repos fresh into a
// temp dir. Only text files survive the filter — the corpus is text-only by
// design (PDFs/slides/images are handled by ingest extraction in a later phase,
// never searched directly).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, '..');
const corpusRoot = path.join(backendRoot, 'corpus');
const repoRoot = path.resolve(backendRoot, '..');
const notesRoot = path.join(repoRoot, 'notes'); // symlink to the Obsidian vault

// Keep the seed small but thematically coherent with the f1tenth repos.
const NOTES_SUBSET = ['16-663 F1Tenth Autonomous Racing'];

const GITHUB_REPOS = [
  {
    id: 'f1tenth_ws',
    url: 'https://github.com/ronchuxia/f1tenth_ws.git',
    repo: 'ronchuxia/f1tenth_ws',
  },
  {
    id: 'f1tenth_sim_ws',
    url: 'https://github.com/ronchuxia/f1tenth_sim_ws.git',
    repo: 'ronchuxia/f1tenth_sim_ws',
  },
];

// Directories never copied into the corpus (VCS, deps, build output).
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.pytest_cache',
  'build',
  'install',
  'log',
  'devel',
  'dist',
  '.vscode',
  '.idea',
]);

// Known binary / generated / model / archive extensions: never searchable text.
const EXCLUDED_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'pgm', 'ppm', 'tif', 'tiff', 'webp',
  'onnx', 'engine', 'pt', 'pth', 'pb', 'tflite', 'h5', 'hdf5', 'npy', 'npz',
  'pkl', 'ckpt', 'safetensors', 'bin', 'weights',
  'pyc', 'pyo', 'o', 'a', 'so', 'dylib', 'dll', 'class', 'jar', 'exe',
  'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar',
  'mp4', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'flac', 'ogg', 'bag', 'svo',
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
]);

// Lockfiles: large, generated, no value for "what did Xia build".
const EXCLUDED_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  'poetry.lock', 'Cargo.lock', 'Pipfile.lock', 'composer.lock',
]);

const MAX_FILE_BYTES = 1_000_000; // skip anything larger than ~1 MB

function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

// Recursively copy text files from srcDir into destDir, applying the filters.
// Returns the number of files copied.
async function copyFiltered(srcDir, destDir) {
  let copied = 0;

  async function walk(dir, relBase) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // never follow symlinks
      const srcPath = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await walk(srcPath, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (EXCLUDED_FILES.has(entry.name)) continue;
      if (EXCLUDED_EXTS.has(extOf(entry.name))) continue;

      const info = await stat(srcPath);
      if (info.size > MAX_FILE_BYTES) continue;

      const buf = await readFile(srcPath);
      if (buf.includes(0)) continue; // NUL byte => treat as binary, skip

      const outPath = path.join(destDir, rel);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, buf);
      copied += 1;
    }
  }

  await walk(srcDir, '');
  return copied;
}

async function main() {
  await rm(corpusRoot, { recursive: true, force: true });
  await mkdir(corpusRoot, { recursive: true });

  const sources = [];

  // --- notes -----------------------------------------------------------------
  let notesFiles = 0;
  for (const folder of NOTES_SUBSET) {
    notesFiles += await copyFiltered(
      path.join(notesRoot, folder),
      path.join(corpusRoot, 'notes', folder),
    );
  }
  sources.push({
    id: 'notes',
    type: 'notes',
    root: 'notes',
    visibility: 'public',
    citation: { base: '/notes/' },
  });
  console.log(`notes:   ${notesFiles} files`);

  // --- github ----------------------------------------------------------------
  const cloneParent = await mkdtemp(path.join(tmpdir(), 'corpus-clone-'));
  try {
    for (const r of GITHUB_REPOS) {
      const cloneDir = path.join(cloneParent, r.id);
      await execFileP('git', ['clone', '--depth', '1', r.url, cloneDir]);
      const sha = (
        await execFileP('git', ['-C', cloneDir, 'rev-parse', 'HEAD'])
      ).stdout.trim();
      const count = await copyFiltered(
        cloneDir,
        path.join(corpusRoot, 'github', r.id),
      );
      sources.push({
        id: r.id,
        type: 'github',
        root: `github/${r.id}`,
        visibility: 'public',
        citation: { repo: r.repo, sha },
      });
      console.log(`${r.id}: ${count} files @ ${sha.slice(0, 10)}`);
    }
  } finally {
    await rm(cloneParent, { recursive: true, force: true });
  }

  // --- registry --------------------------------------------------------------
  await writeFile(
    path.join(corpusRoot, 'sources.json'),
    `${JSON.stringify({ sources }, null, 2)}\n`,
  );

  console.log(`\nSeed corpus built at ${path.relative(process.cwd(), corpusRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
