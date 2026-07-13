// The chat logic: Anthropic and OpenAI tool-use loops over the corpus tools.
//
// runChat stays transport-agnostic — it only yields the contract events
// (status / token / citations / done) and knows nothing about HTTP, SSE, or
// Lambda. Failures throw; the server adapter logs the cause and sanitizes
// every throw into a generic error event.
//
// The selected model plans searches, reads passages, and writes a grounded answer.
// Text deltas stream out as `token` events; tool calls surface as `status`
// events; the sources it read become `citations`.

import { runAnthropic } from './anthropic.js';
import { runOpenAI } from './openai.js';
import { providerRuntime } from './runtime.js';

const MODEL_PROVIDERS = {
  'gpt-5.6-sol': 'openai',
  'gpt-5.6-terra': 'openai',
  'gpt-5.6-luna': 'openai',
  'claude-opus-4-8': 'anthropic',
  'claude-sonnet-5': 'anthropic',
};

export async function* runChat(payload = {}, signal) {
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
  
  if (provider === 'openai') {
    yield* runOpenAI(payload, signal, model, providerRuntime);
    return;
  }
  yield* runAnthropic(payload, signal, model, providerRuntime);
}
