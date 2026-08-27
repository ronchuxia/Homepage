// Local chat-log trace viewer. Dev-only: binds 127.0.0.1 and reads the trace
// files the backend logging local sink writes under
// backend/logs/<yyyy-mm-dd>/<requestId>.json. Imports nothing from
// backend/src/ and is never part of a deploy.
//
//   npm start -> http://127.0.0.1:8788
//
// Routes:
//   GET /                        the viewer page (index.html)
//   GET /api/dates               { dates: [{ date, traceCount }] }, newest first
//   GET /api/traces/<date>       { traces: [sidebar listing entries] }, newest first
//   GET /api/trace/<date>/<id>   one trace, raw file bytes
//
// Env: LOG_VIEWER_PORT (default 8788), CHAT_LOG_LOCAL_DIR (default logs,
// relative to backend/).

import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOGS_ROOT = path.resolve(
  here, '..', 'backend', process.env.CHAT_LOG_LOCAL_DIR || 'logs',
);
const PORT = Number(process.env.LOG_VIEWER_PORT || 8788);

// A missing logs root (logging off, nothing written yet) lists as no dates.
async function listDates() {
  const entries = await readdir(LOGS_ROOT, { withFileTypes: true }).catch(() => []);
  const dates = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map(async (entry) => ({
      date: entry.name,
      traceCount: (await readdir(path.join(LOGS_ROOT, entry.name)))
        .filter((name) => name.endsWith('.json')).length,
    })),
  );
  return dates.sort((a, b) => b.date.localeCompare(a.date));
}

// Sidebar header fields for each trace of one day. Count fields appear in a
// summary only once incremented, hence the zero fallbacks; a file JSON.parse
// cannot read (crash-orphaned partial write) lists as { requestId, parseError }.
async function listTraces(date) {
  const dayDir = path.join(LOGS_ROOT, date);
  const names = (await readdir(dayDir)).filter((name) => name.endsWith('.json'));
  const traces = await Promise.all(names.map(async (name) => {
    const file = path.join(dayDir, name);
    try {
      const { requestId, startedAt, status, mode, request, summary } =
        JSON.parse(await readFile(file, 'utf8'));
      return {
        requestId,
        startedAt,
        status,
        mode,
        model: request.model,
        durationMs: summary.durationMs,
        providerRoundCount: summary.providerRoundCount ?? 0,
        toolCallCount: summary.toolCallCount ?? 0,
        citationCount: summary.citationCount ?? 0,
        sizeBytes: (await stat(file)).size,
      };
    } catch (error) {
      return { requestId: path.basename(name, '.json'), parseError: error.message };
    }
  }));
  return traces.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname === '/') {
      const html = await readFile(path.join(here, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } else if (pathname === '/api/dates') {
      sendJson(res, 200, { dates: await listDates() });
    } else if (pathname.startsWith('/api/traces/')) {
      sendJson(res, 200, { traces: await listTraces(pathname.slice('/api/traces/'.length)) });
    } else if (pathname.startsWith('/api/trace/')) {
      const [date, id] = pathname.slice('/api/trace/'.length).split('/');
      const body = await readFile(path.join(LOGS_ROOT, date, `${id}.json`));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    } else {
      sendJson(res, 404, { error: 'not found' });
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Log viewer listening on http://127.0.0.1:${PORT}`);
  console.log(`Reading traces from ${LOGS_ROOT}`);
});
