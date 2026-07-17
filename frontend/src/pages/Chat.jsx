import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Link } from 'react-router-dom';
import { streamChat } from '../lib/chatClient';

const STARTER_PROMPTS = [
  "What are Xia's main robotics projects?",
  "Summarize Xia's notes on reinforcement learning.",
  'What experience does Xia have with SLAM?',
];

const SESSION_MESSAGES_KEY = 'homepage-chat-messages';
const SESSION_MODEL_KEY = 'homepage-chat-model';
const MODELS = [
  { value: 'gpt-5.6-sol', label: 'ChatGPT 5.6 Sol', shortLabel: 'ChatGPT 5.6 Sol', provider: 'OpenAI' },
  { value: 'gpt-5.6-terra', label: 'ChatGPT 5.6 Terra', shortLabel: 'ChatGPT 5.6 Terra', provider: 'OpenAI' },
  { value: 'gpt-5.6-luna', label: 'ChatGPT 5.6 Luna', shortLabel: 'ChatGPT 5.6 Luna', provider: 'OpenAI' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', shortLabel: 'Opus 4.8', provider: 'Anthropic' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5', shortLabel: 'Sonnet 5', provider: 'Anthropic' },
];

const nextId = () => crypto.randomUUID();

function normalizeMathDelimiters(markdown) {
  const codePattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

  return markdown
    .split(codePattern)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;

      return segment
        .replace(
          /\\\[([\s\S]*?)\\\]/g,
          (_, equation) => `\n\n$$\n${equation.trim()}\n$$\n\n`,
        )
        .replace(/\\\((.*?)\\\)/g, (_, equation) => `$${equation}$`);
    })
    .join('');
}

function MarkdownTable(tableProps) {
  const props = { ...tableProps };
  delete props.node;

  return (
    <div className="markdown-table my-5 overflow-x-auto rounded-lg border border-neutral-200 bg-white shadow-sm">
      <table className="my-0 min-w-full" {...props} />
    </div>
  );
}

function loadSessionMessages() {
  try {
    const messages = JSON.parse(sessionStorage.getItem(SESSION_MESSAGES_KEY));
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

function loadSessionModel() {
  const stored = sessionStorage.getItem(SESSION_MODEL_KEY);
  return MODELS.some((model) => model.value === stored) ? stored : 'claude-opus-4-8';
}

function markResponseStopped(messages, assistantId) {
  return messages.map((message) =>
    message.id === assistantId
      ? { ...message, status: '', citations: [], stopped: true }
      : message,
  );
}

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

function CitationIcon({ type }) {
  if (type === 'code') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-current">
        <path d="M12 .7a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A12 12 0 0 0 12 .7Z" />
      </svg>
    );
  }

  if (type === 'note') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M6.5 15v-6l2.5 3 2.5-3v6M14 12h3.5m-1.75-1.75L17.5 12l-1.75 1.75" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h4M9 13h6M9 17h6" />
    </svg>
  );
}

function Citation({ citation }) {
  const isInternal = citation.url?.startsWith('/');
  const className =
    'inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:border-sky-300 hover:text-sky-700';
  const label = (
    <>
      <CitationIcon type={citation.type} />
      {citation.source && (
        <span className="text-neutral-400">{citation.source}</span>
      )}
      {citation.source && <span aria-hidden="true">·</span>}
      {citation.title}
    </>
  );

  if (isInternal) {
    return (
      <Link to={citation.url} className={className}>
        {label}
      </Link>
    );
  }
  return (
    <a href={citation.url} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
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
      {message.model && (
        <span className="text-xs text-neutral-400">
          {MODELS.find((model) => model.value === message.model)?.label}
        </span>
      )}
      {message.content && (
        <article className="chat-prose prose prose-neutral max-w-none text-[15px] leading-relaxed prose-headings:tracking-tight prose-p:my-2 prose-p:first:mt-0 prose-p:last:mb-0 prose-li:my-0.5 prose-a:text-sky-700 prose-a:no-underline hover:prose-a:underline prose-pre:rounded-lg prose-pre:border prose-pre:border-neutral-200 prose-pre:bg-neutral-950 prose-pre:text-neutral-50">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{ table: MarkdownTable }}
          >
            {normalizeMathDelimiters(message.content)}
          </ReactMarkdown>
        </article>
      )}
      {message.status && (
        <div className="flex items-center gap-1.5 text-sm text-neutral-500">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" />
          <span className="ml-1">{message.status}</span>
        </div>
      )}
      {message.stopped && (
        <p className="text-sm text-neutral-500">Response stopped.</p>
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

function ModelPicker({ model, onChange, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const selected = MODELS.find((option) => option.value === model);

  useEffect(() => {
    if (!isOpen) return;

    function closeMenu(event) {
      if (!menuRef.current?.contains(event.target)) setIsOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className="flex h-9 min-w-28 items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs font-medium text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              selected?.provider === 'OpenAI' ? 'bg-emerald-500' : 'bg-orange-400'
            }`}
          />
          <span key={model} className="animate-page-in motion-reduce:animate-none">
            {selected?.shortLabel}
          </span>
        </span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`h-3.5 w-3.5 text-neutral-400 transition-transform duration-200 motion-reduce:transition-none ${
            isOpen ? 'rotate-180' : ''
          }`}
        >
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      <div
        role="listbox"
        aria-label="Model"
        aria-hidden={!isOpen}
        className={`absolute bottom-full right-0 z-30 mb-2 w-56 origin-bottom-right rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.14)] transition-[opacity,transform] motion-reduce:transition-none ${
          isOpen
            ? 'pointer-events-auto translate-y-0 scale-100 opacity-100 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]'
            : 'pointer-events-none translate-y-2 scale-[0.96] opacity-0 duration-150 ease-in'
        }`}
      >
        {['OpenAI', 'Anthropic'].map((provider) => (
          <div key={provider}>
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              {provider}
            </p>
            {MODELS.filter((option) => option.provider === provider).map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                tabIndex={isOpen ? 0 : -1}
                aria-selected={option.value === model}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                  option.value === model
                    ? 'bg-sky-50 font-medium text-sky-700'
                    : 'text-neutral-700 hover:bg-neutral-100'
                }`}
              >
                {option.label}
                {option.value === model && <span aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState(loadSessionMessages);
  const [model, setModel] = useState(loadSessionModel);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const activeAssistantIdRef = useRef(null);
  const bottomRef = useRef(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    sessionStorage.setItem(SESSION_MESSAGES_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    sessionStorage.setItem(SESSION_MODEL_KEY, model);
  }, [model]);

  useEffect(() => {
    return () => {
      const controller = abortRef.current;
      const assistantId = activeAssistantIdRef.current;
      if (!controller || controller.signal.aborted || !assistantId) return;

      const stoppedMessages = markResponseStopped(messagesRef.current, assistantId);
      messagesRef.current = stoppedMessages;
      sessionStorage.setItem(SESSION_MESSAGES_KEY, JSON.stringify(stoppedMessages));
      controller.abort();
    };
  }, []);

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
      {
        id: assistantId,
        role: 'assistant',
        model,
        content: '',
        status: '',
        citations: [],
      },
    ]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    activeAssistantIdRef.current = assistantId;

    try {
      const payload = history.map(({ role, content }) => ({ role, content }));
      for await (const event of streamChat({
        messages: payload,
        model,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;

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
          updateAssistant(assistantId, () => ({ status: '' }));
          setError(event.message);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Chat connection failed:', err);
        setError('Connection failed.');
      }
    } finally {
      if (abortRef.current === controller) {
        setIsStreaming(false);
        abortRef.current = null;
        activeAssistantIdRef.current = null;
      }
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  function stop() {
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      setMessages((current) => markResponseStopped(current, assistantId));
    }
    abortRef.current?.abort();
  }

  function startNewChat() {
    const controller = abortRef.current;
    abortRef.current = null;
    activeAssistantIdRef.current = null;
    controller?.abort();

    messagesRef.current = [];
    setMessages([]);
    setInput('');
    setError('');
    setIsStreaming(false);
    sessionStorage.removeItem(SESSION_MESSAGES_KEY);
  }

  const isEmpty = messages.length === 0;

  return (
    <main className="relative flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-[#f7f7f4] text-neutral-950">
      <WavyBackground faded={!isEmpty} />
      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
          {isEmpty ? (
            <div className="flex min-h-[calc(100vh-16rem)] animate-fade-up flex-col items-center justify-center text-center motion-reduce:animate-none">
              <h1 className="text-3xl font-semibold tracking-tight">
                Ask my AI agent
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
            {!isEmpty && (
              <button
                type="button"
                onClick={startNewChat}
                aria-label="New chat"
                title="New chat"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-500 shadow-sm transition-colors hover:border-neutral-300 hover:bg-neutral-100 hover:text-sky-700"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <path d="M4.5 4.5h11a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4.5 2.5v-2.5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
                  <path d="M10 7v6M7 10h6" />
                </svg>
              </button>
            )}
            <ModelPicker model={model} onChange={setModel} disabled={isStreaming} />
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
            Agent may be wrong; check the cited notes.
          </p>
        </div>
      </div>
    </main>
  );
}
