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

describe('ChatGPTAdapter.checkStatus with realistic HTML', () => {
  let adapter: ChatGPTAdapter;
  const task: Task = { id: '1', prompt: 'test', status: TaskStatus.RUNNING };

  // HTML for "Inputted text, pending submission" state from user
  const htmlPendingSubmission = `
    <div class=""><div class="bg-token-bg-primary corner-superellipse/1.1 cursor-text overflow-clip bg-clip-padding p-2.5 contain-inline-size dark:bg-[#303030] grid grid-cols-[auto_1fr_auto] [grid-template-areas:'header_header_header'_'leading_primary_trailing'_'._footer_.'] group-data-expanded/composer:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing'] shadow-short" style="border-radius: 28px;"><div class="-my-2.5 flex min-h-14 items-center overflow-x-hidden px-1.5 [grid-area:primary] group-data-expanded/composer:mb-0 group-data-expanded/composer:px-2.5"><div class="wcDTda_prosemirror-parent text-token-text-primary max-h-[max(30svh,5rem)] max-h-52 min-h-[var(--deep-research-composer-extra-height,unset)] flex-1 overflow-auto [scrollbar-width:thin] default-browser vertical-scroll-fade-mask"><textarea class="wcDTda_fallbackTextarea" name="prompt-textarea" placeholder="询问任何问题" data-virtualkeyboard="true" data-auto-resize="true" style="display: none; height: 0px;"></textarea><script nonce="">window.__oai_logHTML?window.__oai_logHTML():window.__oai_SSR_HTML=window.__oai_SSR_HTML||Date.now();requestAnimationFrame((function(){window.__oai_logTTI?window.__oai_logTTI():window.__oai_SSR_TTI=window.__oai_SSR_TTI||Date.now()}))</script><div contenteditable="true" translate="no" class="ProseMirror" id="prompt-textarea" data-virtualkeyboard="true"><p data-placeholder="询问任何问题" class="placeholder"><br class="ProseMirror-trailingBreak"></p></div></div></div><div class="[grid-area:leading]"><span class="flex" data-state="closed"><button type="button" class="composer-btn" data-testid="composer-plus-btn" aria-label="添加文件等" id="composer-plus-btn" aria-haspopup="menu" aria-expanded="false" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon"><use href="/cdn/assets/sprites-core-i9agxugi.svg#6be74c" fill="currentColor"></use></svg></button></span></div><div class="flex items-center gap-2 [grid-area:trailing]"><div class="ms-auto flex items-center gap-1.5"><span class="" data-state="closed"><button aria-label="听写按钮" type="button" class="composer-btn"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-label="" class="icon" font-size="inherit"><use href="/cdn/assets/sprites-core-i9agxugi.svg#29f921" fill="currentColor"></use></svg></button></span><div><span class="" data-state="closed"><div><div class="relative"><button type="button" aria-label="启动语音模式" class="composer-submit-button-color text-submit-btn-text flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:opacity-70 focus-visible:outline-black focus-visible:outline-none disabled:text-[#f4f4f4] disabled:opacity-30 dark:focus-visible:outline-white" style="view-transition-name: var(--vt-composer-speech-button);"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="h-5 w-5"><use href="/cdn/assets/sprites-core-i9agxugi.svg#f8aa74" fill="currentColor"></use></svg></button></div></div></span></div></div></div></div></div>
    <button id="composer-submit-button" aria-label="发送提示" data-testid="send-button" class="composer-submit-btn composer-submit-button-color h-9 w-9"></button>
  `;

  // HTML for "Submitted text, generating response" state from user
  const htmlGeneratingResponse = `
    <div class="bg-token-bg-primary corner-superellipse/1.1 cursor-text overflow-clip bg-clip-padding p-2.5 contain-inline-size dark:bg-[#303030] grid grid-cols-[auto_1fr_auto] [grid-template-areas:'header_header_header'_'leading_primary_trailing'_'._footer_.'] group-data-expanded/composer:[grid-template-areas:'header_header_header'_'primary_primary_primary'_'leading_footer_trailing'] shadow-short" style="border-radius: 28px; transform: none; transform-origin: 50% 50% 0px;"><div class="-my-2.5 flex min-h-14 items-center overflow-x-hidden px-1.5 [grid-area:primary] group-data-expanded/composer:mb-0 group-data-expanded/composer:px-2.5" style="transform: none; transform-origin: 50% 50% 0px;"><div class="wcDTda_prosemirror-parent text-token-text-primary max-h-[max(30svh,5rem)] max-h-52 min-h-[var(--deep-research-composer-extra-height,unset)] flex-1 overflow-auto [scrollbar-width:thin] default-browser vertical-scroll-fade-mask"><textarea class="wcDTda_fallbackTextarea" name="prompt-textarea" placeholder="学习新知识" data-virtualkeyboard="true" data-auto-resize="true" style="display: none; height: 0px;"></textarea><script nonce="">window.__oai_logHTML?window.__oai_logHTML():window.__oai_SSR_HTML=window.__oai_SSR_HTML||Date.now();requestAnimationFrame((function(){window.__oai_logTTI?window.__oai_logTTI():window.__oai_SSR_TTI=window.__oai_SSR_TTI||Date.now()}))</script><div contenteditable="true" translate="no" class="ProseMirror" id="prompt-textarea" data-virtualkeyboard="true"><p data-placeholder="学习新知识" class="placeholder"><br class="ProseMirror-trailingBreak"></p></div></div></div><div class="[grid-area:leading]" style="transform: none; transform-origin: 50% 50% 0px;"><span class="flex" data-state="closed"><button type="button" class="composer-btn" data-testid="composer-plus-btn" aria-label="添加文件等" id="composer-plus-btn" aria-haspopup="menu" aria-expanded="false" data-state="closed"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" class="icon"><use href="/cdn/assets/sprites-core-i9agxugi.svg#6be74c" fill="currentColor"></use></svg></button></span></div><div data-testid="composer-footer-actions" class="-m-1 max-w-full overflow-x-auto p-1 [grid-area:footer] [scrollbar-width:none]" style="transform: none; transform-origin: 50% 50% 0px;"><div class="flex min-w-fit items-center cant-hover:px-1.5 cant-hover:gap-1.5"><div><div class="flex items-center gap-1.5"><button type="button" class="__composer-pill group" aria-label="学习，点击以重试"><div class="__composer-pill-icon" inert=""><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" data-rtl-flip="" class="icon" aria-label=""><use href="/cdn/assets/sprites-core-i9agxugi.svg#1fa93b" fill="currentColor"></use></svg></div><span class="max-w-40 truncate [[data-collapse-labels]_&amp;]:sr-only">学习</span><div class="__composer-pill-remove" inert=""><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" aria-hidden="true" class="icon-sm"><use href="/cdn/assets/sprites-core-i9agxugi.svg#23ce94" fill="currentColor"></use></svg></div></button></div></div></div></div><div class="flex items-center gap-2 [grid-area:trailing]" style="transform: none; transform-origin: 50% 50% 0px;"><div class="ms-auto flex items-center gap-1.5"><span class="" data-state="closed"><button aria-label="听写按钮" type="button" class="composer-btn"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-label="" class="icon" font-size="inherit"><use href="/cdn/assets/sprites-core-i9agxugi.svg#29f921" fill="currentColor"></use></svg></button></span><button id="composer-submit-button" aria-label="停止流式传输" data-testid="stop-button" class="composer-submit-btn composer-secondary-button-color h-9 w-9"></button></div></div></div>
  `;

  beforeEach(() => {
    const dom = new JSDOM();
    global.document = dom.window.document;
    adapter = new ChatGPTAdapter(task);
    // Reset mocks
    vi.clearAllMocks();
  });

  it('should return COMPLETED when submit button is visible (from user HTML)', async () => {
    document.body.innerHTML = htmlPendingSubmission;
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.COMPLETED);
  });

  it('should return RUNNING when stop button is visible (from user HTML)', async () => {
    document.body.innerHTML = htmlGeneratingResponse;
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.RUNNING);
  });

  it('should return FAILED when an error alert is detected', async () => {
    document.body.innerHTML = `<div role="alert">An error occurred</div>`;
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.FAILED);
  });
  
  it('should return COMPLETED after response text is stable', async () => {
    document.body.innerHTML = `<div data-testid="conversation-turn"><div data-message-author-role="assistant">Hello</div></div>`;

    // Simulate 3 stable checks
    await adapter.checkStatus(); // Initializes lastResponseLength
    await adapter.checkStatus(); // stableCheckCount = 1
    await adapter.checkStatus(); // stableCheckCount = 2
    
    // 4th check should result in COMPLETED
    const status = await adapter.checkStatus();
    expect(status).toBe(TaskStatus.COMPLETED);
  });

});
