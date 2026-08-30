import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { Writable } from 'node:stream';

// The Lambda runtime injects the `awslambda` global; recreate it before the
// module under test evaluates, recording metadata on the stream.
globalThis.awslambda = {
  HttpResponseStream: {
    from(stream, metadata) {
      stream.metadata = metadata;
      return stream;
    },
  },
  streamifyResponse: (fn) => fn,
};

// Route the adapter's pumpChat import through a swappable `pump` so the
// keepalive and deadline tests can stand in slow or hanging pumps. Needs
// the --experimental-test-module-mocks flag (set in the npm test script).
const { validateChatPayload, pumpChat } = await import('../src/chat/index.js');
let pump = pumpChat;
mock.module('../src/chat/index.js', {
  namedExports: {
    validateChatPayload,
    pumpChat: (...args) => pump(...args),
  },
});

// The adapter fetches provider keys from Secrets Manager at module load
// when the secret ARN is set.
mock.module('@aws-sdk/client-secrets-manager', {
  namedExports: {
    SecretsManagerClient: class {
      async send() {
        return { SecretString: JSON.stringify({ ANTHROPIC_API_KEY: 'secret-key' }) };
      }
    },
    GetSecretValueCommand: class {},
  },
});
process.env.PROVIDER_KEYS_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:0:secret:x';

const { handleEvent } = await import('../src/lambda.js');
delete process.env.PROVIDER_KEYS_SECRET_ARN;

test('loads provider keys from the secret at module load', () => {
  assert.equal(process.env.ANTHROPIC_API_KEY, 'secret-key');
});

function makeStream() {
  const stream = new Writable({
    write(chunk, encoding, callback) {
      stream.body += chunk.toString();
      callback();
    },
  });
  stream.body = '';
  return stream;
}

const context = { getRemainingTimeInMillis: () => 300_000 };

function chatEvent(payload) {
  return {
    httpMethod: 'POST',
    path: '/api/chat',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

test('serves /health', async () => {
  const stream = makeStream();
  await handleEvent({ httpMethod: 'GET', path: '/api/health', headers: {} }, stream, context);
  assert.equal(stream.metadata.statusCode, 200);
  assert.deepEqual(JSON.parse(stream.body), { status: 'ok' });
});

test('returns 404 for unknown routes', async () => {
  const stream = makeStream();
  await handleEvent({ httpMethod: 'GET', path: '/nope', headers: {} }, stream, context);
  assert.equal(stream.metadata.statusCode, 404);
});

test('returns 404 for a missing material', async () => {
  const stream = makeStream();
  await handleEvent(
    { httpMethod: 'GET', path: '/api/materials/does-not-exist.pdf', headers: {} },
    stream,
    context,
  );
  assert.equal(stream.metadata.statusCode, 404);
  assert.deepEqual(JSON.parse(stream.body), { error: 'material not found' });
});

test('rejects requests without the origin secret when configured', async (t) => {
  process.env.CHAT_ORIGIN_SECRET = 'expected';
  t.after(() => delete process.env.CHAT_ORIGIN_SECRET);

  const denied = makeStream();
  await handleEvent({ httpMethod: 'GET', path: '/api/health', headers: {} }, denied, context);
  assert.equal(denied.metadata.statusCode, 403);

  const allowed = makeStream();
  await handleEvent(
    { httpMethod: 'GET', path: '/api/health', headers: { 'X-Origin-Verify': 'expected' } },
    allowed,
    context,
  );
  assert.equal(allowed.metadata.statusCode, 200);
});

test('rejects an invalid chat body before streaming', async () => {
  const stream = makeStream();
  await handleEvent(chatEvent({ messages: 'bad' }), stream, context);
  assert.equal(stream.metadata.statusCode, 400);
  assert.deepEqual(JSON.parse(stream.body), { error: 'invalid request body' });
});

test('streams chat failures as an SSE error event', async () => {
  const stream = makeStream();
  await handleEvent(
    chatEvent({ messages: [{ role: 'user', content: 'hi' }], model: 'nope' }),
    stream,
    context,
  );
  assert.equal(stream.metadata.statusCode, 200);
  assert.equal(stream.metadata.headers['Content-Type'], 'text/event-stream');
  assert.ok(stream.body.includes('data: {"type":"error","message":"Backend failed."}'));
});

test('emits keepalive comments during silent phases', async (t) => {
  process.env.CHAT_KEEPALIVE_MS = '10';
  pump = () => new Promise((resolve) => setTimeout(resolve, 50));
  t.after(() => {
    delete process.env.CHAT_KEEPALIVE_MS;
    pump = pumpChat;
  });

  const stream = makeStream();
  await handleEvent(
    chatEvent({ messages: [{ role: 'user', content: 'hi' }], model: 'claude-opus-4-8' }),
    stream,
    context,
  );
  assert.ok(stream.body.includes(': keepalive\n\n'));
});

test('reports failure and aborts when the deadline fires', async (t) => {
  pump = (payload, send, signal) =>
    new Promise((resolve) => signal.addEventListener('abort', resolve));
  t.after(() => {
    pump = pumpChat;
  });

  const stream = makeStream();
  const shortContext = { getRemainingTimeInMillis: () => 10_020 };
  await handleEvent(
    chatEvent({ messages: [{ role: 'user', content: 'hi' }], model: 'claude-opus-4-8' }),
    stream,
    shortContext,
  );
  assert.ok(stream.body.includes('data: {"type":"error","message":"Backend failed."}'));
});
