import OpenAI from 'openai';

import { FINAL_SYSTEM_PROMPT, SYSTEM_PROMPT } from './system-prompt.js';
import { TOOLS } from './tool-definitions.js';

const EFFORT = process.env.OPENAI_REASONING_EFFORT || 'medium';

const OPENAI_TOOLS = TOOLS.map(({ name, description, input_schema }) => ({
  type: 'function',
  name,
  description,
  parameters: input_schema,
  strict: false,
}));

export async function* runOpenAI({ messages }, signal, model, runtime) {
  const client = new OpenAI();
  const conversation = messages.map(({ role, content }) => ({ role, content }));
  const cite = { read: new Map(), search: new Map() };
  const trace = runtime.trace;
  const reasoning = {
    effort: EFFORT,
    ...(runtime.reasoningSummariesEnabled ? { summary: 'auto' } : {}),
  };
  let exhaustedToolRounds = false;

  for (let round = 0; round < runtime.maxToolRounds; round += 1) {
    const toolRound = round + 1;
    const started = Date.now();
    const request = {
      model,
      instructions: SYSTEM_PROMPT,
      input: conversation,
      max_output_tokens: runtime.maxTokens,
      tools: OPENAI_TOOLS,
      reasoning,
      store: false,
      stream: true,
      include: ['reasoning.encrypted_content'],
    };
    trace.incrementSummaryMetric('providerRoundCount');
    trace.appendEvent(
      'provider.round.started',
      { providerRound: toolRound },
      { modelRequest: request },
    );
    const stream = await client.responses.create(request, { signal });

    let response;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        trace.appendSummaryAssistantResponse(event.delta);
        yield { type: 'token', text: event.delta };
      }
      if (event.type === 'response.completed') {
        response = event.response;
      }
    }

    if (!response) throw new Error('OpenAI response stream ended before completion.');
    conversation.push(...response.output);

    const toolCalls = response.output.filter((item) => item.type === 'function_call');
    trace.incrementSummaryTokenUsage(response.usage);
    trace.appendEvent(
      'provider.round.completed',
      {
        providerRound: toolRound,
        durationMs: Date.now() - started,
        status: response.status,
        toolCallCount: toolCalls.length,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      },
      { modelResponse: response.output },
    );
    if (!toolCalls.length) break;

    const toolResults = [];
    for (const call of toolCalls) {
      let toolInput;
      try {
        toolInput = JSON.parse(call.arguments || '{}');
      } catch {
        toolInput = {};
      }
      const block = { name: call.name, input: toolInput };
      yield { type: 'status', text: runtime.statusFor(block) };
      const result = await runtime.runTool(block, cite, toolRound);
      toolResults.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: result.content,
      });
    }
    conversation.push(...toolResults);
    exhaustedToolRounds = round === runtime.maxToolRounds - 1;
  }

  if (exhaustedToolRounds) {
    const started = Date.now();
    const providerRound = runtime.maxToolRounds + 1;
    const request = {
      model,
      instructions: FINAL_SYSTEM_PROMPT,
      input: conversation,
      max_output_tokens: runtime.maxTokens,
      tools: OPENAI_TOOLS,
      tool_choice: 'none',
      reasoning,
      store: false,
      stream: true,
      include: ['reasoning.encrypted_content'],
    };
    trace.setSummaryMetric('maxToolRoundsReached', true);
    trace.incrementSummaryMetric('providerRoundCount');
    trace.appendEvent(
      'provider.round.started',
      { providerRound },
      { modelRequest: request },
    );
    const stream = await client.responses.create(request, { signal });

    let response;
    let finalText = '';
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        finalText += event.delta;
        trace.appendSummaryAssistantResponse(event.delta);
        yield { type: 'token', text: event.delta };
      }
      if (event.type === 'response.completed') {
        response = event.response;
      }
    }

    if (!response) {
      throw new Error('OpenAI final response stream ended before completion.');
    }
    trace.incrementSummaryTokenUsage(response.usage);
    trace.appendEvent(
      'provider.round.completed',
      {
        providerRound,
        durationMs: Date.now() - started,
        status: response.status,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      },
      { modelResponse: response.output },
    );
    if (!finalText.trim()) {
      throw new Error('OpenAI returned an empty final answer.');
    }
  }

  yield* runtime.finishWithCitations(cite);
}
