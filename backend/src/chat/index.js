// The chat logic: Anthropic and OpenAI tool-use loops over the corpus tools.
//
// runChat stays transport-agnostic — it only yields the contract events
// (status / token / citations / done) and knows nothing about HTTP, SSE, or
// Lambda. The server adapter delivers those events.
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
    yield { type: 'error', message: 'Model is required.' };
    yield { type: 'done' };
    return;
  }

  const provider = MODEL_PROVIDERS[model];
  if (!provider) {
    yield { type: 'error', message: 'Model is invalid.' };
    yield { type: 'done' };
    return;
  }

  const keyName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  if (!process.env[keyName]) {
    yield { type: 'error', message: 'Model is unavailable.' };
    yield { type: 'done' };
    return;
  }
  
  if (provider === 'openai') {
    yield* runOpenAI(payload, signal, model, providerRuntime);
    return;
  }
  yield* runAnthropic(payload, signal, model, providerRuntime);
}
