import { beforeEach, describe, expect, test, vi } from 'vitest';

async function loadClient() {
  vi.resetModules();
  vi.stubEnv('VITE_CHAT_API_URL', 'https://example.test/chat');
  return import('../src/lib/chatClient.js');
}

function streamBody(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function collect(generator) {
  const events = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('streamChat', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  test('posts the conversation and parses fragmented stream events', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: streamBody([
        'data: {"type":"token","text":"Hel',
        'lo"}\n\ndata: {"type":"done"}\n\n',
      ]),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { streamChat } = await loadClient();
    const messages = [{ role: 'user', content: 'Hello' }];
    const controller = new AbortController();

    await expect(
      collect(streamChat({
        messages,
        model: 'claude-opus-4-8',
        signal: controller.signal,
      })),
    ).resolves.toEqual([
      { type: 'token', text: 'Hello' },
      { type: 'done' },
    ]);

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, model: 'claude-opus-4-8' }),
      signal: controller.signal,
    });
  });

  test('ignores malformed frames and continues parsing', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: streamBody([
        'data: not-json\n\n',
        'event: ping\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    }));
    const { streamChat } = await loadClient();

    await expect(
      collect(streamChat({ messages: [], model: 'claude-opus-4-8' })),
    ).resolves.toEqual([{ type: 'done' }]);
    expect(warning).toHaveBeenCalledOnce();
  });

  test('throws when the backend response is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    }));
    const { streamChat } = await loadClient();

    await expect(
      collect(streamChat({ messages: [], model: 'claude-opus-4-8' })),
    ).rejects.toThrow('Request failed (503)');
  });
});
