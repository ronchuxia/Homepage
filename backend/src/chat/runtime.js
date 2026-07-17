import path from 'node:path';

import { listSources } from '../tools/list-sources.js';
import { readFileWindow } from '../tools/read-file.js';
import { searchCorpus } from '../tools/search-corpus.js';

const MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || 4096);
const MAX_TOOL_ROUNDS = Number(process.env.CHAT_MAX_TOOL_ROUNDS || 6);

function statusFor(block) {
  if (block.name === 'search_corpus') {
    const query = block.input?.query;
    return query ? `Searching “${query}”…` : 'Searching the corpus…';
  }
  if (block.name === 'read_file') {
    const filePath = block.input?.path;
    return filePath ? `Reading ${path.basename(filePath)}…` : 'Reading a file…';
  }
  if (block.name === 'list_sources') {
    return 'Listing sources…';
  }
  return 'Working…';
}

async function runTool(block, cite, toolRound, trace) {
  const started = Date.now();
  const metadata = {
    toolName: block.name,
    toolRound,
    ...(block.input?.path ? { filePath: block.input.path } : {}),
  };
  trace.incrementSummaryMetric('toolCallCount');
  trace.appendEvent('tool.started', metadata, { arguments: block.input });

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
      const result = {
        content: JSON.stringify({
          hits: hits.map((hit) => ({
            path: hit.path,
            line: hit.line,
            text: hit.text,
          })),
          truncated,
        }),
      };
      trace.appendEvent(
        'tool.completed',
        {
          ...metadata,
          durationMs: Date.now() - started,
          resultCount: hits.length,
          truncated: truncated,
        },
        { result: result.content },
      );
      return result;
    }

    if (block.name === 'read_file') {
      const result = await readFileWindow({
        path: block.input.path,
        startLine: block.input.start_line,
        lineCount: block.input.line_count,
      });
      if (result.citation.url) cite.read.set(result.path, result.citation);
      const toolResult = {
        content: `${result.path} (lines ${result.startLine}-${result.endLine} of ${result.totalLines}):\n${result.content}`,
      };
      trace.appendEvent(
        'tool.completed',
        {
          ...metadata,
          durationMs: Date.now() - started,
        },
        { result: toolResult.content },
      );
      return toolResult;
    }

    if (block.name === 'list_sources') {
      const sources = await listSources({ scope: block.input.scope });
      const result = { content: JSON.stringify(sources) };
      trace.appendEvent(
        'tool.completed',
        {
          ...metadata,
          durationMs: Date.now() - started,
          resultCount: sources.length,
        },
        { result: result.content },
      );
      return result;
    }

    throw new Error(`Unknown tool: ${block.name}`);
  } catch (error) {
    trace.appendEvent('tool.failed', {
      ...metadata,
      durationMs: Date.now() - started,
      errorName: error.name,
      errorMessage: error.message,
      stack: error.stack,
    });
    return { content: `Error: ${error.message}`, is_error: true };
  }
}

function citationsFrom(cite) {
  const sources = cite.read.size ? [...cite.read.values()] : [...cite.search.values()];
  return sources.slice(0, 6).map((citation) => ({
    source: citation.source,
    title: citation.title,
    type: citation.type,
    url: citation.url,
  }));
}

async function* finishWithCitations(cite, trace) {
  const citations = citationsFrom(cite);
  trace.setSummaryMetric('citationCount', citations.length);
  for (const citation of citations) {
    trace.appendEvent('citation.selected', { citation });
  }
  if (citations.length) {
    yield { type: 'citations', citations };
  }
  yield { type: 'done' };
}

export function createProviderRuntime(trace) {
  return {
    maxTokens: MAX_TOKENS,
    maxToolRounds: MAX_TOOL_ROUNDS,
    reasoningSummariesEnabled:
      process.env.CHAT_REASONING_SUMMARIES === 'true',
    trace,
    statusFor,
    runTool: (block, cite, toolRound) => runTool(block, cite, toolRound, trace),
    finishWithCitations: (cite) => finishWithCitations(cite, trace),
  };
}
