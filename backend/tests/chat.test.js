import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { runChat } from '../src/chat/index.js';

const originalOpenAIKey = process.env.OPENAI_API_KEY;
const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

async function consume(generator) {
  for await (const event of generator) {
    void event;
  }
}

before(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

after(() => {
  if (originalOpenAIKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  }

  if (originalAnthropicKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  }
});

test('runChat requires a model', async () => {
  await assert.rejects(consume(runChat()), /Model is required/);
});

test('runChat rejects an unsupported model', async () => {
  await assert.rejects(
    consume(runChat({ model: 'unsupported-model' })),
    /Model is invalid: unsupported-model/,
  );
});

test('runChat requires the selected OpenAI key', async () => {
  await assert.rejects(
    consume(runChat({ model: 'gpt-5.6-sol', messages: [] })),
    /Key is not set: OPENAI_API_KEY/,
  );
});

test('runChat requires the selected Anthropic key', async () => {
  await assert.rejects(
    consume(runChat({ model: 'claude-opus-4-8', messages: [] })),
    /Key is not set: ANTHROPIC_API_KEY/,
  );
});
