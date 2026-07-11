// Local HTTP server that exposes the chat backend during development.
//
//   GET  /health       -> { status: 'ok' }           liveness check
//   POST /chat         -> Server-Sent Events stream   the chat contract
//
//   Phase 2 debug endpoints (no model — exercise the search tools directly):
//   GET  /sources?scope=        -> list_sources
//   POST /search       { query, scope, limit }        -> search_corpus
//   POST /search_file  { path, query, limit }          -> search_file
//   POST /read         { path, startLine, lineCount }  -> read_file
//
// It is a thin transport adapter: it reads the request, calls the logic (runChat
// or a search tool), and writes the result back. The same logic can later be
// driven by a Lambda streaming handler without changes.

import { createServer } from 'node:http';
import { runChat } from './chat/index.js';
import { listSources } from './tools/list-sources.js';
import { readFileWindow } from './tools/read-file.js';
import { searchCorpus } from './tools/search-corpus.js';
import { searchFile } from './tools/search-file.js';

const PORT = process.env.PORT || 8787;

// Dev-only: the Vite dev server (a different origin) calls this, so allow CORS.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(payload));
}

// Read a JSON body, run a tool with it, and reply with JSON; map any tool error
// (bad input, path escape, timeout) to a 400 with its message.
async function handleJson(req, res, run) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'invalid request body' });
    return;
  }
  try {
    sendJson(res, 200, await run(body));
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/chat') {
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json', ...CORS_HEADERS });
      res.end(JSON.stringify({ error: 'invalid request body' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...CORS_HEADERS,
    });

    // Stop generating if the client disconnects (e.g. the Stop button).
    const controller = new AbortController();
    req.on('close', () => controller.abort());

    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    try {
      for await (const event of runChat(payload, controller.signal)) {
        send(event);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        send({ type: 'error', message: 'The chat backend failed.' });
      }
    } finally {
      res.end();
    }
    return;
  }

  // --- Phase 2 debug endpoints: exercise the search tools without a model. ---

  if (req.method === 'GET' && url.pathname === '/sources') {
    try {
      const scope = url.searchParams.get('scope') || 'all';
      sendJson(res, 200, await listSources({ scope }));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/search') {
    await handleJson(req, res, searchCorpus);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/search_file') {
    await handleJson(req, res, searchFile);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/read') {
    await handleJson(req, res, readFileWindow);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`Chat stub backend listening on http://localhost:${PORT}`);
});
