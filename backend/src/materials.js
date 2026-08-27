// Public material serving over backend/corpus/materials/.
//
// Every visitor-facing file request goes through here so that a pathname
// supplied by the client can never escape /corpus/materials. Materials are
// PDFs streamed so citations can open `#page=N`.

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { CORPUS_ROOT, safeRelPath } from './corpus.js';

export const MATERIALS_ROOT = path.join(CORPUS_ROOT, 'materials');

// URL-decode a /materials/<path> request pathname and confine it to the
// materials root.
export function safeMaterialPath(pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname.slice('/materials/'.length));
  } catch {
    throw new Error('path is invalid');
  }
  return safeRelPath(relative, MATERIALS_ROOT);
}

export async function serveMaterialRequest(res, pathname, {
  root = MATERIALS_ROOT,
  headers = {},
} = {}) {
  let absolute;
  let info;
  try {
    absolute = path.join(root, safeMaterialPath(pathname));
    info = await stat(absolute);
  } catch (error) {
    console.error(`Material request failed for ${pathname}:`, error);
    const responseHeaders = {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    };
    res.writeHead(404, responseHeaders);
    res.end(JSON.stringify({ error: 'material not found' }));
    return;
  }

  const responseHeaders = {
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'Content-Length': String(info.size),
    'Content-Type': 'application/pdf',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  };
  res.writeHead(200, responseHeaders);
  try {
    await pipeline(createReadStream(absolute), res);
  } catch (error) {
    console.error(`Material request failed for ${pathname}:`, error);
  }
}
