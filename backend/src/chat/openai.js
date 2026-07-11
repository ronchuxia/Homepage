import OpenAI from 'openai';

import { SYSTEM_PROMPT } from './system-prompt.js';
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
  let exhaustedToolRounds = false;

  for (let round = 0; round < runtime.maxToolRounds; round += 1) {
    const stream = await client.responses.create(
      {
        model,
        instructions: SYSTEM_PROMPT,
        input: conversation,
        max_output_tokens: runtime.maxTokens,
        tools: OPENAI_TOOLS,
        reasoning: { effort: EFFORT },
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content'],
      },
      { signal },
    );

    let response;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield { type: 'token', text: event.delta };
      }
      if (event.type === 'response.completed') {
        response = event.response;
      }
    }

    if (!response) throw new Error('OpenAI response stream ended before completion.');
    conversation.push(...response.output);

    const toolCalls = response.output.filter((item) => item.type === 'function_call');
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
      const result = await runtime.runTool(block, cite);
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
    const stream = await client.responses.create(
      {
        model,
        instructions: SYSTEM_PROMPT,
        input: conversation,
        max_output_tokens: runtime.maxTokens,
        tools: OPENAI_TOOLS,
        tool_choice: 'none',
        reasoning: { effort: EFFORT },
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content'],
      },
      { signal },
    );

    let completed = false;
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        yield { type: 'token', text: event.delta };
      }
      if (event.type === 'response.completed') {
        completed = true;
      }
    }

    if (!completed) {
      throw new Error('OpenAI final response stream ended before completion.');
    }
  }

  yield* runtime.finishWithCitations(cite);
}
