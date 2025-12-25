import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { ChatGPTAdapter } from './chatgpt-adapter';
import { Task, TaskStatus } from '../types/task';

// Mock chrome.runtime.sendMessage
vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: vi.fn(),
  },
});

describe('ChatGPTAdapter.checkStatus', () => {
  let adapter: ChatGPTAdapter;
  const task: Task = { id: '1', prompt: 'test', status: TaskStatus.RUNNING };

  beforeEach(() => {
    const dom = new JSDOM();
    global.document = dom.window.document;
    adapter = new ChatGPTAdapter(task);
    // Reset mocks before each test
    vi.clearAllMocks();
  });

  // --- RUNNING STATUS ---
  it('should return RUNNING when stop button is visible', async () => {
    document.body.innerHTML = `<button data-testid="stop-button">Stop</button>`;
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);
  });

  it('should return RUNNING when loading indicator is visible', async () => {
    document.body.innerHTML = `<div class="result-streaming"></div>`;
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);
  });
  
  it('should return RUNNING when waiting for response to appear', async () => {
    document.body.innerHTML = ``; // No response yet
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);
  });

  // --- COMPLETED STATUS ---
  it('should return COMPLETED when submit button is enabled', async () => {
    document.body.innerHTML = `<button data-testid="send-button">Send</button>`; // Button is not disabled
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.COMPLETED);
  });

  it('should return COMPLETED after response text is stable for 3 checks', async () => {
    document.body.innerHTML = `<div data-testid="conversation-turn">
        <div data-message-author-role="assistant">Hello there</div>
    </div>`;

    // 1st check - text length is new
    let status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);

    // 2nd check - text length is same, stable count becomes 1
    status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);
    
    // 3rd check - text length is same, stable count becomes 2
    status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);
    
    // 4th check - text length is same, stable count becomes 3 -> COMPLETED
    status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.COMPLETED);
  });

  it('should reset stable check count if text changes', async () => {
    document.body.innerHTML = `<div data-testid="conversation-turn">
        <div data-message-author-role="assistant">Hello</div>
    </div>`;

    // 1st-3rd checks to increment count
    await adapter.checkStatus(); // RUNNING
    await adapter.checkStatus(); // RUNNING, count = 1
    await adapter.checkStatus(); // RUNNING, count = 2

    // Change the content
    const responseElement = document.querySelector('[data-message-author-role="assistant"]');
    if (responseElement) {
        responseElement.textContent = 'Hello there!';
    }
    
    // 4th check - text changed, count should reset to 0
    let status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);

    // 5th check - count should now be 1
    status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);
    
    // 6th check - count should now be 2
    status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);

    // 7th check - count should be 3 -> COMPLETED
    status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.COMPLETED);
  });


  // --- FAILED STATUS ---
  it('should return FAILED when an error alert is detected', async () => {
    document.body.innerHTML = `<div role="alert">An error occurred</div>`;
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.FAILED);
  });

});
