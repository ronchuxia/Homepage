// The chat logic: Anthropic and OpenAI tool-use loops over the corpus tools,
// and the HTTP/SSE serving of POST /chat (serveChatRequest).
//
// runChat stays transport-agnostic — it only yields the contract events
// (status / token / citations / done) and knows nothing about HTTP, SSE, or
// Lambda. Failures throw; serveChatRequest logs the cause and sanitizes every
// throw into an allowlisted error event.
//
// The selected model plans searches, reads passages, and writes a grounded answer.
// Text deltas stream out as `token` events; tool calls surface as `status`
// events; the sources it read become `citations`.

import { runAnthropic } from './anthropic.js';
import { runOpenAI } from './openai.js';
import { createProviderRuntime } from './runtime.js';
import { createTrace } from '../logging/index.js';

const MODEL_PROVIDERS = {
  'gpt-5.6-sol': 'openai',
  'gpt-5.6-terra': 'openai',
  'gpt-5.6-luna': 'openai',
  'claude-opus-4-8': 'anthropic',
  'claude-sonnet-5': 'anthropic',
};

const ROLES = new Set(['user', 'assistant']);

function publicErrorMessage(error) {
  if (
    (error.status === 429 && error.code === 'insufficient_quota') ||
    (error.status === 400 && error.message?.includes('credit balance'))
  ) {
    return 'The AI service is out of credits. Try another provider.';
  }
  if (error.status === 429 || error.status >= 500) {
    return 'The AI service is temporarily overloaded. Try again later.';
  }
  return 'Backend failed.';
}

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

export function validateChatPayload(payload) {
  if (!Array.isArray(payload?.messages)) {
    throw new Error('messages must be an array');
  }
  for (const message of payload.messages) {
    if (!ROLES.has(message?.role)) {
      throw new Error('message role is invalid');
    }
    if (typeof message.content !== 'string') {
      throw new Error('message content must be a string');
    }
  }
}

export async function* runChat(payload = {}, signal, trace) {
  const model = payload.model;
  if (!model) {
    throw new Error('Model is required.');
  }

  const provider = MODEL_PROVIDERS[model];
  if (!provider) {
    throw new Error(`Model is invalid: ${model}`);
  }
  const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  if (!process.env[keyName]) {
    throw new Error(`Key is not set: ${keyName}`);
  }

  const runtime = createProviderRuntime(trace);
  if (provider === 'openai') {
    yield* runOpenAI(payload, signal, model, runtime);
    return;
  }
  yield* runAnthropic(payload, signal, model, runtime);
}

export async function pumpChat(payload, send, signal) {
  const trace = createTrace();
  trace.setRequest(payload);

  let terminalError;
  try {
    for await (const event of runChat(payload, signal, trace)) {
      send(event);
    }
  } catch (error) {
    terminalError = error;
    if (!signal.aborted) {
      console.error('Chat backend failed:', error);
      send({ type: 'error', message: publicErrorMessage(error) });
    }
  } finally {
    const status = signal.aborted
      ? 'aborted'
      : terminalError
        ? 'failed'
        : 'completed';
    await trace.finalize(status, terminalError);
  }
}

export async function serveChatRequest(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
    validateChatPayload(payload);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid request body' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Stop generating if the client disconnects (e.g. the Stop button).
  // Listen on res: req 'close' fires when the request body completes (before
  // this listener attaches), so an abort wired to it never triggers.
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  try {
    await pumpChat(payload, send, controller.signal);
  } finally {
    res.end();
  }
}
