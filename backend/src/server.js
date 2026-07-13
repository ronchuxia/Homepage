// Local HTTP server that exposes the chat backend during development.
//
//   GET  /health       -> { status: 'ok' }           liveness check
//   POST /chat         -> Server-Sent Events stream   the chat contract
//
// It is a thin transport adapter: it reads the request, calls runChat, and
// writes the result back. The same logic can later be driven by a Lambda
// streaming handler without changes.

import { createServer } from 'node:http';
import { runChat } from './chat/index.js';

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
        send({ type: 'error', message: 'Backend failed.' });
      }
    } finally {
      res.end();
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`Chat stub backend listening on http://localhost:${PORT}`);
});
