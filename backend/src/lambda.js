// AWS Lambda streaming adapter

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { pumpChat, validateChatPayload } from './chat/index.js';
import { MATERIALS_ROOT, safeMaterialPath } from './materials.js';

if (process.env.PROVIDER_KEYS_SECRET_ARN) {
  const response = await new SecretsManagerClient().send(
    new GetSecretValueCommand({ SecretId: process.env.PROVIDER_KEYS_SECRET_ARN }),
  );
  Object.assign(process.env, JSON.parse(response.SecretString));
}

const DEADLINE_BUFFER_MS = 10_000;

// Writes the body through pipeline rather than a single end(payload):
// ending the response stream in the same tick it is wrapped drops the
// metadata prelude on the real Lambda runtime and API Gateway rejects
// the response.
async function endStream(stream, statusCode, body) {
  const out = awslambda.HttpResponseStream.from(stream, {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
  await pipeline(Readable.from(JSON.stringify(body)), out);
}

function getHeader(event, name) {
  const key = Object.keys(event.headers || {}).find(
    (candidate) => candidate.toLowerCase() === name,
  );
  return key ? event.headers[key] : undefined;
}

async function serveMaterial(responseStream, pathname) {
  let absolute;
  let info;
  try {
    absolute = path.join(MATERIALS_ROOT, safeMaterialPath(pathname));
    info = await stat(absolute);
  } catch (error) {
    console.error(`Material request failed for ${pathname}:`, error);
    await endStream(responseStream, 404, { error: 'material not found' });
    return;
  }

  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Length': String(info.size),
      'Content-Type': 'application/pdf',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  try {
    await pipeline(createReadStream(absolute), out);
  } catch (error) {
    console.error(`Material request failed for ${pathname}:`, error);
  }
}

async function serveChat(event, responseStream, context) {
  let payload;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString()
      : event.body || '';
    if (raw.length > 1_000_000) {
      throw new Error('payload too large');
    }
    payload = raw ? JSON.parse(raw) : {};
    validateChatPayload(payload);
  } catch {
    await endStream(responseStream, 400, { error: 'invalid request body' });
    return;
  }

  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
  const send = (frame) => out.write(`data: ${JSON.stringify(frame)}\n\n`);

  const keepaliveMs = Number(process.env.CHAT_KEEPALIVE_MS || 15_000);
  const keepalive = setInterval(() => out.write(': keepalive\n\n'), keepaliveMs);
  const controller = new AbortController();
  const deadline = setTimeout(() => {
    send({ type: 'error', message: 'Backend failed.' });
    controller.abort();
  }, context.getRemainingTimeInMillis() - DEADLINE_BUFFER_MS);

  try {
    await pumpChat(payload, send, controller.signal);
  } finally {
    clearInterval(keepalive);
    clearTimeout(deadline);
    out.end();
  }
}

export async function handleEvent(event, responseStream, context) {
  const secret = process.env.CHAT_ORIGIN_SECRET;
  if (secret && getHeader(event, 'x-origin-verify') !== secret) {
    await endStream(responseStream, 403, { error: 'forbidden' });
    return;
  }

  const method = event.httpMethod;
  const pathname = event.path;

  if (method === 'GET' && pathname === '/api/health') {
    await endStream(responseStream, 200, { status: 'ok' });
    return;
  }

  if (method === 'GET' && pathname.startsWith('/api/materials/')) {
    await serveMaterial(responseStream, pathname);
    return;
  }

  if (method === 'POST' && pathname === '/api/chat') {
    await serveChat(event, responseStream, context);
    return;
  }

  await endStream(responseStream, 404, { error: 'not found' });
}

export const handler = awslambda.streamifyResponse(handleEvent);
