// Local HTTP server that exposes the chat backend during development.
//
//   GET  /api/health                 -> { status: 'ok' }           liveness check
//   GET  /api/materials/<file-path>  -> public PDF
//   POST /api/chat                   -> Server-Sent Events stream   the chat contract
//
// A thin router: request handling lives in chat/index.js and materials.js.

import { createServer } from 'node:http';
import { serveChatRequest } from './chat/index.js';
import { serveMaterialRequest } from './materials.js';

const PORT = process.env.PORT || 8787;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/materials/')) {
    await serveMaterialRequest(res, url.pathname);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    await serveChatRequest(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`Chat stub backend listening on http://localhost:${PORT}`);
});
