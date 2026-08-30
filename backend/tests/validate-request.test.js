import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateChatPayload } from '../src/chat/index.js';

test('accepts a valid chat payload', () => {
  validateChatPayload({
    messages: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ],
    model: 'claude-opus-4-8',
  });
});

test('rejects a payload without a messages array', () => {
  assert.throws(() => validateChatPayload({}), /messages must be an array/);
  assert.throws(() => validateChatPayload({ messages: 'Hi' }), /messages must be an array/);
});

test('rejects a message with an invalid role', () => {
  assert.throws(
    () => validateChatPayload({ messages: [{ role: 'system', content: 'x' }] }),
    /message role is invalid/,
  );
});

test('rejects a message with non-string content', () => {
  assert.throws(
    () => validateChatPayload({ messages: [{ role: 'user', content: [1] }] }),
    /message content must be a string/,
  );
});
