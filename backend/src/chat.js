// The chat logic: a Claude tool-use loop over the corpus search tools.
//
// runChat stays transport-agnostic — it only yields the contract events
// (status / token / citations / done) and knows nothing about HTTP, SSE, or
// Lambda. The server adapter delivers those events.
//
// Claude plans searches, reads passages, and writes a grounded, cited answer.
// Text deltas stream out as `token` events; tool calls surface as `status`
// events; the sources it read become `citations`. If no ANTHROPIC_API_KEY is
// set, it returns a friendly message instead so the UI still works.

import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

import { SYSTEM_PROMPT } from './system-prompt.js';
import { TOOLS } from './tools.js';
import { listSources } from './tools/list-sources.js';
import { readFileWindow } from './tools/read-file.js';
import { searchCorpus } from './tools/search-corpus.js';

// Config (env-overridable). Defaults favour a small, cheap-to-run assistant;
// the monthly spend cap on the Anthropic account is the real cost guarantee.
const MODEL = process.env.CHAT_MODEL || 'claude-opus-4-8';
const EFFORT = process.env.CHAT_EFFORT || 'medium'; // low | medium | high | max
const MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 4096);
const MAX_TOOL_ROUNDS = Number(process.env.CHAT_MAX_TOOL_ROUNDS || 6);

function statusFor(block) {
  if (block.name === 'search_corpus') {
    const q = block.input?.query;
    return q ? `Searching “${q}”…` : 'Searching the corpus…';
  }
  if (block.name === 'read_file') {
    const p = block.input?.path;
    return p ? `Reading ${path.basename(p)}…` : 'Reading a file…';
  }
  if (block.name === 'list_sources') {
    return 'Listing sources…';
  }
  return 'Working…';
}

// Run one tool and return { content, is_error? } for the tool_result block.
// `cite` accumulates citations: files read are strong signals; search hits are
// a fallback when the model answers from snippets without reading.
async function runTool(block, cite) {
  try {
    if (block.name === 'search_corpus') {
      const { hits, truncated } = await searchCorpus({
        query: block.input.query,
        scope: block.input.scope,
        limit: block.input.limit,
      });
      for (const hit of hits) {
        if (hit.citation.url) cite.search.set(hit.path, hit.citation);
      }
      return {
        content: JSON.stringify({
          hits: hits.map((h) => ({ path: h.path, line: h.line, text: h.text })),
          truncated,
        }),
      };
    }

    if (block.name === 'read_file') {
      const result = await readFileWindow({
        path: block.input.path,
        startLine: block.input.start_line,
        lineCount: block.input.line_count,
      });
      if (result.citation.url) cite.read.set(result.path, result.citation);
      return {
        content: `${result.path} (lines ${result.startLine}-${result.endLine} of ${result.totalLines}):\n${result.content}`,
      };
    }

    if (block.name === 'list_sources') {
      return { content: JSON.stringify(await listSources({ scope: block.input.scope })) };
    }

    return { content: `Unknown tool: ${block.name}`, is_error: true };
  } catch (error) {
    return { content: `Error: ${error.message}`, is_error: true };
  }
}

async function* runReplica({ messages }, signal) {
  const client = new Anthropic();
  const convo = messages.map(({ role, content }) => ({ role, content }));
  const cite = { read: new Map(), search: new Map() };

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT },
        tools: TOOLS,
        messages: convo,
      },
      { signal },
    );

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield { type: 'token', text: event.delta.text };
      }
    }

    const message = await stream.finalMessage();
    // Echo the assistant turn back verbatim (preserves thinking + tool_use blocks).
    convo.push({ role: 'assistant', content: message.content });

    if (message.stop_reason !== 'tool_use') {
      break; // final answer already streamed as tokens
    }

    const toolResults = [];
    for (const block of message.content) {
      if (block.type !== 'tool_use') continue;
      yield { type: 'status', text: statusFor(block) };
      const result = await runTool(block, cite);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.content,
        ...(result.is_error ? { is_error: true } : {}),
      });
    }
    convo.push({ role: 'user', content: toolResults });
  }

  const sources = cite.read.size ? [...cite.read.values()] : [...cite.search.values()];
  const citations = sources.slice(0, 6).map((c) => ({
    title: c.title,
    type: c.type,
    url: c.url,
  }));
  if (citations.length) {
    yield { type: 'citations', citations };
  }
  yield { type: 'done' };
}

// No key configured: keep the UI working with a clear message instead of the
// real model loop.
async function* runNoKey({ messages }) {
  const question = messages[messages.length - 1]?.content?.trim() ?? '';
  yield { type: 'status', text: 'Backend reachable…' };
  const note =
    'The chat backend is running, but no Anthropic API key is configured yet, ' +
    'so the AI replica is not active. Set ANTHROPIC_API_KEY (and a monthly ' +
    `spend cap) to enable it.\n\nYou asked: "${question}"`;
  for (const chunk of note.match(/\S+\s*/g) ?? []) {
    yield { type: 'token', text: chunk };
  }
  yield { type: 'done' };
}

export async function* runChat(payload = {}, signal) {
  if (!process.env.ANTHROPIC_API_KEY) {
    yield* runNoKey(payload);
    return;
  }
  yield* runReplica(payload, signal);
}
