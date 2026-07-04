import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { streamChat } from '../lib/chatClient';

const STARTER_PROMPTS = [
  "What are Xia's main robotics projects?",
  "Summarize Xia's notes on reinforcement learning.",
  'What experience does Xia have with SLAM?',
];

let idSeq = 0;
const nextId = () => `m${idSeq++}`;

// Drifting sine lines drawn on a canvas behind the chat.
const waves = [
  { color: '124, 122, 232', width: 2.5, alpha: 0.75, seed: 0.0, fa: 0.31, fk: 0.13, fp: 0.6 },
  { color: '140, 205, 165', width: 1.5, alpha: 0.6, seed: 2.1, fa: 0.23, fk: 0.17, fp: 0.45 },
  { color: '215, 150, 170', width: 1.5, alpha: 0.55, seed: 4.3, fa: 0.41, fk: 0.1, fp: 0.7 },
  { color: '170, 170, 175', width: 1.2, alpha: 0.45, seed: 6.7, fa: 0.19, fk: 0.27, fp: 0.35 },
];

function WavyBackground({ faded }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let frame;

    function resize() {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    addEventListener('resize', resize);
    resize();

    function draw(now) {
      const t = now / 1000;
      const W = innerWidth, H = innerHeight, mid = H / 2;
      ctx.clearRect(0, 0, W, H);

      for (const w of waves) {
        const s = w.seed;
        const amp = (H * 0.2) * (0.6 + 0.4 * Math.sin(t * w.fa + s));
        const k = (2 * Math.PI / W) * (1.2 + 0.4 * Math.sin(t * w.fk + s));
        const ph = t * w.fp + s;

        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const y = mid + amp * Math.sin(k * x + ph);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${w.color}, ${w.alpha})`;
        ctx.lineWidth = w.width;
        ctx.shadowColor = `rgba(${w.color}, 0.6)`;
        ctx.shadowBlur = 8;
        ctx.stroke();
      }
      frame = requestAnimationFrame(draw);
    }

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(0);
    } else {
      frame = requestAnimationFrame(draw);
    }

    return () => {
      removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 h-full w-full transition-opacity duration-1000 ${
        faded ? 'opacity-20' : 'opacity-100'
      }`}
    />
  );
}

function Citation({ citation }) {
  const isInternal = citation.url?.startsWith('/');
  const className =
    'inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:border-sky-300 hover:text-sky-700';

  if (isInternal) {
    return (
      <Link to={citation.url} className={className}>
        {citation.title}
      </Link>
    );
  }
  return (
    <a href={citation.url} target="_blank" rel="noopener noreferrer" className={className}>
      {citation.title}
    </a>
  );
}

function Message({ message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-sky-600 px-4 py-2.5 text-[15px] text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {message.status && !message.content && (
        <div className="flex items-center gap-1.5 text-sm text-neutral-500">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" />
          <span className="ml-1">{message.status}</span>
        </div>
      )}
      {message.content && (
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-neutral-900">
          {message.content}
        </div>
      )}
      {message.citations?.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {message.citations.map((c) => (
            <Citation key={c.url} citation={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function updateAssistant(id, updater) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...updater(m) } : m)),
    );
  }

  async function send(text) {
    const content = text.trim();
    if (!content || isStreaming) return;

    setError('');
    setInput('');
    const userMessage = { id: nextId(), role: 'user', content };
    const assistantId = nextId();
    const history = [...messages, userMessage];

    setMessages([
      ...history,
      { id: assistantId, role: 'assistant', content: '', status: '', citations: [] },
    ]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload = history.map(({ role, content }) => ({ role, content }));
      for await (const event of streamChat({
        messages: payload,
        signal: controller.signal,
      })) {
        if (event.type === 'status') {
          updateAssistant(assistantId, () => ({ status: event.text }));
        } else if (event.type === 'token') {
          updateAssistant(assistantId, (m) => ({
            status: '',
            content: m.content + event.text,
          }));
        } else if (event.type === 'citations') {
          updateAssistant(assistantId, () => ({ citations: event.citations }));
        } else if (event.type === 'error') {
          setError(event.message);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Something went wrong.');
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  const isEmpty = messages.length === 0;

  return (
    <main className="relative flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-[#f7f7f4] text-neutral-950">
      <WavyBackground faded={!isEmpty} />
      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
          {isEmpty ? (
            <div className="flex min-h-[calc(100vh-16rem)] flex-col items-center justify-center text-center">
              <h1 className="text-3xl font-semibold tracking-tight">
                Ask my AI replica
              </h1>
              <p className="mt-3 max-w-md text-neutral-500">
                Grounded in Xia&apos;s notes and projects. Ask about the work,
                the ideas, or where to start reading.
              </p>
              <div className="mt-8 flex w-full max-w-md flex-col gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => send(prompt)}
                    className="rounded-xl border border-neutral-300 bg-white px-4 py-3 text-left text-sm text-neutral-700 transition-colors hover:border-sky-300 hover:text-sky-700"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {messages.map((m) => (
                <Message key={m.id} message={m} />
              ))}
              {error && (
                <p className="border-l-2 border-red-600 pl-3 text-sm text-red-700">
                  {error}
                </p>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>

      <div className="relative z-10 border-t border-neutral-200 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-6 py-4 sm:px-10">
          <div className="flex items-end gap-2 rounded-2xl border border-neutral-300 bg-white px-3 py-2 focus-within:border-sky-400">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Ask anything about Xia's work…"
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[15px] text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={stop}
                className="shrink-0 rounded-lg bg-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-300"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send(input)}
                disabled={!input.trim()}
                className="shrink-0 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                Send
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-xs text-neutral-400">
            Replica may be wrong; check the cited notes. Connected to a stub
            backend — no AI yet.
          </p>
        </div>
      </div>
    </main>
  );
}
