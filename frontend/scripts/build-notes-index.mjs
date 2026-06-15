#!/usr/bin/env node

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const markdownExtension = '.md';

function parseArgs(argv) {
  const args = {
    source: '../notes',
    out: 'public/notes',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--source') {
      args.source = argv[index + 1];
      index += 1;
    } else if (arg === '--out') {
      args.out = argv[index + 1];
      index += 1;
    }
  }

  return args;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function titleFromPath(filePath) {
  return path.basename(filePath, markdownExtension);
}

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function addTreeNode(tree, note) {
  const parts = note.path.split('/');
  let children = tree;
  let currentPath = '';

  parts.forEach((part, index) => {
    const isNote = index === parts.length - 1;
    currentPath = currentPath ? `${currentPath}/${part}` : part;

    if (isNote) {
      children.push({
        type: 'note',
        name: part,
        slug: note.slug,
        path: note.path,
      });

      return;
    }

    let folder = children.find(
      (child) => child.type === 'folder' && child.path === currentPath,
    );

    if (!folder) {
      folder = {
        type: 'folder',
        name: part,
        path: currentPath,
        children: [],
      };
      children.push(folder);
    }

    children = folder.children;
  });
}

function sortTree(nodes) {
  nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'folder' ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, { numeric: true });
  });

  nodes.forEach((node) => {
    if (node.children) {
      sortTree(node.children);
    }
  });
}

async function copyAsset(sourcePath, sourceRoot, outRoot) {
  const relativePath = path.relative(sourceRoot, sourcePath);
  const outputPath = path.join(outRoot, relativePath);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(sourcePath, outputPath);
}

async function buildNotesIndex() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const sourceRoot = path.resolve(cwd, args.source);
  const outRoot = path.resolve(cwd, args.out);
  const files = await walkFiles(sourceRoot);
  const notes = [];
  const tree = [];

  await mkdir(outRoot, { recursive: true });

  for (const filePath of files) {
    const relativePath = toPosixPath(path.relative(sourceRoot, filePath));

    if (path.extname(filePath) !== markdownExtension) {
      await copyAsset(filePath, sourceRoot, outRoot);
      continue;
    }

    const markdown = await readFile(filePath, 'utf8');
    const slug = relativePath.slice(0, -markdownExtension.length);
    const note = {
      slug,
      title: titleFromPath(relativePath),
      path: relativePath,
    };
    const outputPath = path.join(outRoot, relativePath);

    notes.push(note);
    addTreeNode(tree, note);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, markdown, 'utf8');
  }

  notes.sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { numeric: true }),
  );
  sortTree(tree);

  await writeFile(
    path.join(outRoot, 'index.json'),
    `${JSON.stringify({ notes, tree }, null, 2)}\n`,
    'utf8',
  );

  console.log(`Built ${notes.length} notes into ${args.out}`);
}

buildNotesIndex().catch((error) => {
  console.error(error);
  process.exit(1);
});
