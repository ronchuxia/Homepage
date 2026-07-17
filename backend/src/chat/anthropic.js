import Anthropic from '@anthropic-ai/sdk';

import { SYSTEM_PROMPT } from './system-prompt.js';
import { TOOLS } from './tool-definitions.js';

const EFFORT = process.env.ANTHROPIC_EFFORT || 'medium';

export async function* runAnthropic({ messages }, signal, model, runtime) {
  const client = new Anthropic();
  const conversation = messages.map(({ role, content }) => ({ role, content }));
  const cite = { read: new Map(), search: new Map() };
  const trace = runtime.trace;
  const thinking = {
    type: 'adaptive',
    display: runtime.reasoningSummariesEnabled ? 'summarized' : 'omitted',
  };
  let exhaustedToolRounds = false;

  for (let round = 0; round < runtime.maxToolRounds; round += 1) {
    const toolRound = round + 1;
    const started = Date.now();
    const request = {
      model,
      system: SYSTEM_PROMPT,
      messages: conversation,
      max_tokens: runtime.maxTokens,
      tools: TOOLS,
      thinking,
      output_config: { effort: EFFORT },
    };
    trace.incrementSummaryMetric('providerRoundCount');
    trace.appendEvent(
      'provider.round.started',
      { providerRound: toolRound },
      { modelRequest: request },
    );
    const stream = client.messages.stream(request, { signal });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        trace.appendSummaryAssistantResponse(event.delta.text);
        yield { type: 'token', text: event.delta.text };
      }
    }

    const response = await stream.finalMessage();
    conversation.push({ role: 'assistant', content: response.content });

    const toolCalls = response.content.filter((item) => item.type === 'tool_use');
    trace.incrementSummaryTokenUsage(response.usage);
    trace.appendEvent(
      'provider.round.completed',
      {
        providerRound: toolRound,
        durationMs: Date.now() - started,
        stopReason: response.stop_reason,
        toolCallCount: toolCalls.length,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      },
      { modelResponse: response.content },
    );
    if (!toolCalls.length) break;

    const toolResults = [];
    for (const call of toolCalls) {
      const block = { name: call.name, input: call.input };
      yield { type: 'status', text: runtime.statusFor(block) };
      const result = await runtime.runTool(block, cite, toolRound);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: result.content,
        ...(result.is_error ? { is_error: true } : {}),
      });
    }
    conversation.push({ role: 'user', content: toolResults });
    exhaustedToolRounds = round === runtime.maxToolRounds - 1;
  }

  if (exhaustedToolRounds) {
    const started = Date.now();
    const providerRound = runtime.maxToolRounds + 1;
    const request = {
      model,
      system: SYSTEM_PROMPT,
      messages: conversation,
      max_tokens: runtime.maxTokens,
      tools: TOOLS,
      tool_choice: { type: 'none' },
      thinking,
      output_config: { effort: EFFORT },
    };
    trace.setSummaryMetric('maxToolRoundsReached', true);
    trace.incrementSummaryMetric('providerRoundCount');
    trace.appendEvent(
      'provider.round.started',
      { providerRound },
      { modelRequest: request },
    );
    const stream = client.messages.stream(request, { signal });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        trace.appendSummaryAssistantResponse(event.delta.text);
        yield { type: 'token', text: event.delta.text };
      }
    }

    const response = await stream.finalMessage();
    trace.incrementSummaryTokenUsage(response.usage);
    trace.appendEvent(
      'provider.round.completed',
      {
        providerRound,
        durationMs: Date.now() - started,
        stopReason: response.stop_reason,
        inputTokens: response.usage?.input_tokens || 0,
        outputTokens: response.usage?.output_tokens || 0,
      },
      { modelResponse: response.content },
    );
  }

  yield* runtime.finishWithCitations(cite);
}
