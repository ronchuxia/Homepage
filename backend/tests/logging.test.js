import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createLocalSink } from '../src/logging/local-sink.js';
import { RequestTrace } from '../src/logging/trace.js';

test('metadata traces keep summary data without full content', async () => {
  let writtenRecord;
  const trace = new RequestTrace({
    mode: 'metadata',
    requestId: 'request-metadata',
    write: async (record) => {
      writtenRecord = structuredClone(record);
    },
  });

  trace.setRequest({
    model: 'claude-opus-4-8',
    messages: [{ role: 'user', content: 'Hello' }],
  });
  trace.appendEvent('provider.started', { providerRound: 1 }, {
    modelRequest: { secret: 'not recorded' },
  });
  trace.incrementSummaryMetric('providerRoundCount');
  trace.incrementSummaryMetric('providerRoundCount', 2);
  trace.setSummaryMetric('citationCount', 3);
  trace.incrementSummaryTokenUsage({ input_tokens: 10, output_tokens: 4 });
  trace.appendSummaryAssistantResponse('Answer');
  await trace.finalize('completed');
  await trace.finalize('completed');

  assert.equal(writtenRecord.request.model, 'claude-opus-4-8');
  assert.equal(writtenRecord.request.messageCount, 1);
  assert.equal('messages' in writtenRecord.request, false);
  assert.equal('modelRequest' in writtenRecord.events[0], false);
  assert.deepEqual(Object.keys(writtenRecord.events[0]), [
    'type',
    'at',
    'providerRound',
  ]);
  assert.equal(writtenRecord.summary.providerRoundCount, 3);
  assert.equal(writtenRecord.summary.citationCount, 3);
  assert.equal(writtenRecord.summary.inputTokens, 10);
  assert.equal(writtenRecord.summary.outputTokens, 4);
  assert.equal('assistantResponse' in writtenRecord.summary, false);
  assert.equal(writtenRecord.status, 'completed');
  assert.equal(writtenRecord.events.at(-1).type, 'request.completed');
});

test('full traces snapshot request, event, and response content', async () => {
  let writtenRecord;
  const messages = [{ role: 'user', content: 'Original question' }];
  const details = { modelRequest: { messages: ['original'] } };
  const trace = new RequestTrace({
    mode: 'full',
    requestId: 'request-full',
    write: async (record) => {
      writtenRecord = structuredClone(record);
    },
  });

  trace.setRequest({ model: 'gpt-5.6-sol', messages });
  trace.appendEvent('provider.started', {}, details);
  trace.appendSummaryAssistantResponse('First');
  trace.appendSummaryAssistantResponse(' response');
  messages[0].content = 'Changed question';
  details.modelRequest.messages[0] = 'changed';
  await trace.finalize('completed');

  assert.equal(writtenRecord.request.messages[0].content, 'Original question');
  assert.equal(
    writtenRecord.events[0].modelRequest.messages[0],
    'original',
  );
  assert.deepEqual(Object.keys(writtenRecord.events[0]), [
    'type',
    'at',
    'modelRequest',
  ]);
  assert.equal(writtenRecord.summary.assistantResponse, 'First response');
});

test('disabled traces do not write records', async () => {
  let writeCount = 0;
  const trace = new RequestTrace({
    mode: 'off',
    requestId: 'request-off',
    write: async () => {
      writeCount += 1;
    },
  });

  trace.setRequest({ model: 'claude-opus-4-8', messages: [] });
  trace.appendEvent('provider.started');
  trace.incrementSummaryMetric('providerRoundCount');
  await trace.finalize('completed');

  assert.equal(writeCount, 0);
});

test('trace finalization isolates sink failures', async () => {
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));

  try {
    const trace = new RequestTrace({
      mode: 'metadata',
      requestId: 'request-failure',
      write: async () => {
        throw new Error('sink unavailable');
      },
    });

    await assert.doesNotReject(trace.finalize('failed', new Error('chat failed')));
    assert.match(errors[0], /sink unavailable/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('local sink writes one formatted record under its date directory', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'homepage-log-test-'));
  const record = {
    requestId: 'request-local',
    startedAt: '2026-07-14T12:00:00.000Z',
    status: 'completed',
  };

  try {
    await createLocalSink(directory)(record);
    const outputPath = path.join(
      directory,
      '2026-07-14',
      'request-local.json',
    );
    const output = await readFile(outputPath, 'utf8');

    assert.equal(output, `${JSON.stringify(record, null, 2)}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
