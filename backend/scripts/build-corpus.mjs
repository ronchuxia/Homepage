import { execFile } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(BACKEND, 'corpus.config.json');
const CORPUS = path.join(BACKEND, 'corpus');
const EXCLUDED_SEARCH_EXTENSIONS = new Set([
  '.0',
  '.1',
  '.blend',
  '.d3',
  '.engine',
  '.gif',
  '.jpg',
  '.mp4',
  '.onnx',
  '.pdf',
  '.pgm',
  '.pkl',
  '.png',
  '.pyc',
  '.zip',
]);

async function command(program, args) {
  try { return await execFileP(program, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 32_000_000 }); } catch (error) {
    throw new Error(`${program} failed: ${error.stderr?.trim() || error.message}`);
  }
}

async function clone(source, cloneRoot) {
  const cloneDirectory = path.join(cloneRoot, source.id);
  await command('git', [
    'clone', '--quiet', '--depth', '1', '--branch', source.ref,
    source.url, cloneDirectory,
  ]);
  const sha = (await command('git', ['-C', cloneDirectory, 'rev-parse', 'HEAD'])).stdout.trim();
  const trackedFiles = (await command('git', ['-C', cloneDirectory, 'ls-files', '-z'])).stdout.split('\0').filter(Boolean);
  return { cloneDirectory, sha, trackedFiles };
}

async function copyClone(cloneDirectory, trackedFiles, targetDirectory) {
  for (const trackedFile of trackedFiles) {
    const sourceFilePath = path.join(cloneDirectory, ...trackedFile.split('/'));
    const targetFilePath = path.join(targetDirectory, ...trackedFile.split('/'));
    if (!(await stat(sourceFilePath)).isFile()) continue;
    await mkdir(path.dirname(targetFilePath), { recursive: true });
    await copyFile(sourceFilePath, targetFilePath);
  }
}

async function extractPdf(corpusRoot, trackedFile, parsedPath) {
  const targetPath = path.join(corpusRoot, 'materials', ...trackedFile.split('/'));
  const info = (await command('pdfinfo', [targetPath])).stdout;
  const pageCount = Number(info.match(/^Pages:\s+(\d+)$/m)?.[1]);
  const pagesPath = path.join(corpusRoot, 'search', 'materials', ...parsedPath.split('/'), 'pages');
  await mkdir(pagesPath, { recursive: true });
  for (let page = 1; page <= pageCount; page += 1) {
    const pageNumber = String(page).padStart(4, '0');
    const extracted = (await command('pdftotext', ['-f', String(page), '-l', String(page), '-layout', '-enc', 'UTF-8', targetPath, '-'])).stdout.replace(/\f/g, '').trim();
    const output = path.join(pagesPath, `page-${pageNumber}.txt`);
    await writeFile(output, `${[
      `Page: ${page}`,
      `Source PDF: /materials/${trackedFile}`,
      '',
      extracted,
    ].join('\n').trim()}\n`);
  }
}

async function buildCorpus(corpusRoot, workDir, config) {
  const registry = [];
  const cloneRoot = path.join(workDir, 'clones');
  await mkdir(cloneRoot);
  for (const source of config.sources) {
    const registryStart = registry.length;
    try {
      const { cloneDirectory, sha, trackedFiles } = await clone(source, cloneRoot);
      if (source.type === 'materials') {
        await copyClone(cloneDirectory, trackedFiles, path.join(corpusRoot, 'materials'));
        const pdfFiles = trackedFiles.filter((trackedFile) => /\.pdf$/i.test(trackedFile));
        for (const trackedFile of pdfFiles) {
          const parsedPath = trackedFile.replace(/\.pdf$/i, '');
          await extractPdf(corpusRoot, trackedFile, parsedPath);
          registry.push({
            type: source.type,
            root: `search/materials/${parsedPath}`,
            revision: { repo: source.url, sha },
            citation: {
              base: new URL(`/materials/${trackedFile}`, config.publicBackendOrigin).toString(),
            },
          });
        }
      } else {
        const searchPath = source.type === 'notes'
          ? 'search/notes'
          : `search/${source.type}/${source.id}`;
        const searchFiles = trackedFiles.filter(
          (trackedFile) => !EXCLUDED_SEARCH_EXTENSIONS.has(path.extname(trackedFile).toLowerCase()),
        );
        await copyClone(cloneDirectory, searchFiles, path.join(corpusRoot, searchPath));
        const citation = source.type === 'github'
          ? { base: `${source.url.replace(/\.git$/, '')}/blob/${sha}` }
          : { base: source.citationBase };
        registry.push({ id: source.id, type: source.type, root: searchPath, revision: { repo: source.url, sha }, citation });
      }
    } catch (error) {
      registry.length = registryStart;
      const outputs = source.type === 'materials'
        ? ['materials', 'search/materials']
        : [source.type === 'notes' ? 'search/notes' : `search/${source.type}/${source.id}`];
      for (const output of outputs) await rm(path.join(corpusRoot, output), { recursive: true, force: true });
      console.warn(`Skipping ${source.id}: ${error.message}`);
    }
  }
  await writeFile(path.join(corpusRoot, 'sources.json'), `${JSON.stringify({ sources: registry }, null, 2)}\n`);
}

const config = JSON.parse(await readFile(CONFIG, 'utf8'));
const workDir = await mkdtemp(path.join(BACKEND, '.corpus-work-'));
try {
  await rm(CORPUS, { recursive: true, force: true });
  await mkdir(CORPUS);
  await buildCorpus(CORPUS, workDir, config);
  console.log(`Corpus built at ${CORPUS}`);
} finally {
  await rm(workDir, { recursive: true, force: true });
}
