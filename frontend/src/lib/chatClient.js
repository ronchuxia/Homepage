// Chat transport. Defines the contract between the chat UI and the backend.
//
// Request:  POST { messages: [{ role, content }], model, sourceScope }
// Response: a stream of events (SSE `data: {json}` from the real backend),
//           each one of:
//             { type: 'status',    text }            retrieval/progress note
//             { type: 'token',     text }            a chunk of the answer
//             { type: 'citations', citations: [...] } sources for the answer
//             { type: 'done' }
//             { type: 'error',     message }
//
// Until VITE_CHAT_API_URL is set, a local mock simulates the stream so the UI
// can be built and tested with no backend.

const API_URL = import.meta.env.VITE_CHAT_API_URL;

export async function* streamChat({ messages, model, sourceScope = 'all', signal }) {
  if (!API_URL) {
    yield* mockStream({ messages, signal });
    return;
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, model, sourceScope }),
    signal,
  });

  if (!response.ok || !response.body) {
    yield { type: 'error', message: `Request failed (${response.status})` };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(5).trim());
      } catch {
        // ignore malformed frames
      }
    }
  }
}

// --- mock --------------------------------------------------------------------

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

async function* mockStream({ messages, signal }) {
  const question = messages[messages.length - 1]?.content?.trim() ?? '';

  yield { type: 'status', text: 'Searching notes…' };
  await delay(600, signal);

  const answer =
    `This is a placeholder reply. The real agent will search Xia's notes ` +
    `and projects to answer your question, then respond with citations. ` +
    `Streaming and the source links below are wired up — the backend just ` +
    `isn't connected yet.\n\nYou asked: "${question}"`;

  for (const chunk of answer.match(/\S+\s*/g) ?? []) {
    await delay(28, signal);
    yield { type: 'token', text: chunk };
  }

  yield {
    type: 'citations',
    citations: [
      {
        source: '16-663 F1Tenth Autonomous Racing',
        title: 'Scan Matching',
        type: 'note',
        url: '/notes/16-663 F1Tenth Autonomous Racing/4 Scan Matching',
      },
      {
        source: '16-663 F1Tenth Autonomous Racing',
        title: 'Particle Filter',
        type: 'note',
        url: '/notes/16-663 F1Tenth Autonomous Racing/6 Particle Filter',
      },
    ],
  };
  yield { type: 'done' };
}
