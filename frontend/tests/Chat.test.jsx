import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import Chat from '../src/pages/Chat.jsx';
import { streamChat } from '../src/lib/chatClient.js';

vi.mock('../src/lib/chatClient.js', () => ({
  streamChat: vi.fn(),
}));

function renderChat() {
  return render(
    <MemoryRouter>
      <Chat />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  streamChat.mockImplementation(async function* emptyStream() {
    yield { type: 'done' };
  });
});

test('starts with prompts and a disabled send button', () => {
  renderChat();

  expect(screen.getByRole('heading', { name: 'Ask My AI Assistant' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: "What are Xia's robotics projects?" }),
  ).toBeInTheDocument();
});

test('sends conversation history and renders the streamed answer', async () => {
  sessionStorage.setItem('homepage-chat-messages', JSON.stringify([
    { id: 'user-1', role: 'user', content: 'First question' },
    { id: 'assistant-1', role: 'assistant', content: 'First answer' },
  ]));
  streamChat.mockImplementation(async function* answerStream() {
    yield { type: 'status', text: 'Searching' };
    yield { type: 'token', text: 'Second answer' };
    yield { type: 'done' };
  });
  const user = userEvent.setup();
  renderChat();

  await user.type(
    screen.getByPlaceholderText('Ask me anything about Xia...'),
    'Follow up',
  );
  await user.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => {
    expect(streamChat).toHaveBeenCalledOnce();
  });
  expect(streamChat).toHaveBeenCalledWith({
    messages: [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow up' },
    ],
    model: 'claude-opus-4-8',
    signal: expect.any(AbortSignal),
  });
  expect(await screen.findByText('Second answer')).toBeInTheDocument();
});

test('interleaves text parts with persistent tool call chips', async () => {
  let resumeStream;
  const streamPaused = new Promise((resolve) => {
    resumeStream = resolve;
  });
  streamChat.mockImplementation(async function* toolAfterTextStream() {
    yield { type: 'token', text: 'First part.' };
    yield { type: 'status', text: 'Searching' };
    yield { type: 'status', text: 'Reading' };
    await streamPaused;
    yield { type: 'token', text: 'Second part.' };
    yield { type: 'done' };
  });
  const user = userEvent.setup();
  renderChat();

  await user.type(
    screen.getByPlaceholderText('Ask me anything about Xia...'),
    'Use a tool',
  );
  await user.click(screen.getByRole('button', { name: 'Send' }));

  // While the group is at the streaming frontier, only the current tool
  // shows, as the animated status line; nothing is collapsed yet.
  expect(await screen.findByText('First part.')).toBeInTheDocument();
  expect(await screen.findByText('Reading')).toBeInTheDocument();
  expect(screen.queryByText('Searching')).not.toBeInTheDocument();
  expect(screen.queryByText('2 tool calls')).not.toBeInTheDocument();

  await act(async () => {
    resumeStream();
  });

  // Once narration follows, the group collapses into a disclosure and stays.
  expect(await screen.findByText('Second part.')).toBeInTheDocument();
  expect(screen.getByText('First part.')).toBeInTheDocument();
  expect(screen.getByText('2 tool calls')).toBeInTheDocument();
});

test('keeps tool call chips when the backend returns an error', async () => {
  streamChat.mockImplementation(async function* emptyFinalAnswerStream() {
    yield { type: 'token', text: 'First part.' };
    yield { type: 'status', text: 'Searching' };
    yield { type: 'error', message: 'Backend failed.' };
  });
  const user = userEvent.setup();
  renderChat();

  await user.type(
    screen.getByPlaceholderText('Ask me anything about Xia...'),
    'Use too many tools',
  );
  await user.click(screen.getByRole('button', { name: 'Send' }));

  expect(await screen.findByText('Backend failed.')).toBeInTheDocument();
  expect(screen.getByText('First part.')).toBeInTheDocument();
  expect(screen.getByText('1 tool call')).toBeInTheDocument();
});

test('shows a generic error when the chat connection fails', async () => {
  const connectionError = new Error('private backend detail');
  streamChat.mockImplementation(async function* failedStream() {
    yield { type: 'status', text: 'Connecting' };
    throw connectionError;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const user = userEvent.setup();
  renderChat();

  await user.type(
    screen.getByPlaceholderText('Ask me anything about Xia...'),
    'Hello',
  );
  await user.click(screen.getByRole('button', { name: 'Send' }));

  expect(await screen.findByText('Connection failed.')).toBeInTheDocument();
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
});
