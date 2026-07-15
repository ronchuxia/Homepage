import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
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

  expect(screen.getByRole('heading', { name: 'Ask my AI agent' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: "What are Xia's main robotics projects?" }),
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
    screen.getByPlaceholderText("Ask anything about Xia's work…"),
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
    screen.getByPlaceholderText("Ask anything about Xia's work…"),
    'Hello',
  );
  await user.click(screen.getByRole('button', { name: 'Send' }));

  expect(await screen.findByText('Connection failed.')).toBeInTheDocument();
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
});
