// Chat transport. Defines the contract between the chat UI and the backend.
//
// Request:  POST { messages: [{ role, content }], model }
// Response: a stream of events (SSE `data: {json}` from the real backend),
//           each one of:
//             { type: 'status',    text }            retrieval/progress note
//             { type: 'token',     text }            a chunk of the answer
//             { type: 'citations', citations: [...] } sources for the answer
//             { type: 'done' }
//             { type: 'error',     message }
//
// Transport failures (missing URL, unreachable backend, bad status, dropped
// stream) throw; the caller catches and shows a generic message.
//
const API_URL = import.meta.env.VITE_CHAT_API_URL;

export async function* streamChat({ messages, model, signal }) {
  if (!API_URL) {
    throw new Error('Backend URL is required.');
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, model }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed (${response.status})`);
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
        console.warn('Malformed frame:', frame);
      }
    }
  }
}
