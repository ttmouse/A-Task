// [IN]: DOM (ChatGPT), BaseAdapter
// [OUT]: DOM Manipulation (Input/Submit), Status Monitoring
// [POS]: Adapters Layer / Concrete Implementation (ChatGPT)
// Protocol: When updated, sync this header + src/adapters/.folder.md

import { BaseAdapter } from './base-adapter.js';
import { TaskStatus } from '../types/task.js';

// AIDEV-NOTE: ChatGPT 适配器实现，适配新版 ProseMirror 输入框与多状态提交区

export class ChatGPTAdapter extends BaseAdapter {
  // AIDEV-NOTE: 根据实际 ChatGPT 页面结构确定的选择器
  private static readonly SELECTORS = {
    // 输入框选择器 - ChatGPT 使用 ProseMirror contenteditable + fallback textarea
    inputBox: '#prompt-textarea[contenteditable="true"], div.ProseMirror[contenteditable="true"], textarea[name="prompt-textarea"], textarea[data-id="root"]',
    composerForm: 'form[data-type="unified-composer"]',
    // 提交按钮选择器（发送按钮会根据状态增删）
    submitButton: '#composer-submit-button, button[data-testid="send-button"], button[aria-label="发送提示"], button[aria-label="Send prompt"]',
    // 停止生成按钮
    stopButton: 'button[data-testid="stop-button"], button[aria-label="停止流式传输"], button[aria-label*="Stop"]',
    // 消息容器 - ChatGPT 现在通常使用 article 标签或及其父级
    messagesContainer: 'div.flex.flex-col.items-center, div[role="presentation"], [data-testid="conversation-turn"], main',
    // 最新响应
    latestResponse: '[data-testid="conversation-turn"]:last-child [data-message-author-role="assistant"], article:last-child [data-message-author-role="assistant"], .markdown.prose:last-of-type',
    // 加载指示器
    loadingIndicator: '.result-streaming, [data-testid="streaming-loader"]'
  };

  /**
   * AIDEV-NOTE: 提交内容到 ChatGPT（支持多步骤任务）
   * @param content 要提交的内容（当前步骤内容或完整 prompt）
   */
  async submitContent(content: string): Promise<boolean> {
    try {
      // 查找输入框
      this.sendDebugLog('info', '🔍 正在查找输入框...');
      const inputBox = this.findVisibleInputBox();
      if (!inputBox) {
        this.sendDebugLog('error', '❌ 找不到输入框，请检查选择器');
        throw new Error('找不到 ChatGPT 输入框');
      }
      this.sendDebugLog('success', '✅ 输入框定位成功');

      this.fillInputBox(inputBox, content);
      this.dispatchInputEvents(inputBox, content);

      if (content.trim().length > 0 && !this.didContentAppear(inputBox, content)) {
        this.sendDebugLog('error', '❌ 输入框写入后检查失败，没有检测到文本');
        throw new Error('输入框写入失败');
      }

      this.sendDebugLog('success', `✅ 内容已输入 (${content.length} 字符)`);

      // 等待让输入生效
      await this.sleep(500);

      // 查找并点击提交按钮
      this.sendDebugLog('info', '🔍 正在查找提交按钮...');
      const submitButton = await this.waitForElement<HTMLButtonElement>(ChatGPTAdapter.SELECTORS.submitButton);
      if (!submitButton) {
        const composerState = this.getComposerState();
        this.sendDebugLog('error', `❌ 找不到提交按钮，当前状态: ${composerState}`);
        throw new Error('找不到 ChatGPT 提交按钮');
      }

      // 检查按钮是否可用
      if (!this.isButtonEnabled(submitButton)) {
        this.sendDebugLog('warning', '⚠️ 提交按钮不可用');
        throw new Error('提交按钮不可用');
      }

      this.sendDebugLog('success', '✅ 提交按钮定位成功');
      submitButton.click();
      this.sendDebugLog('success', '✅ 已点击提交按钮');

      // 如果是多步骤任务，记录当前步骤
      const stepInfo = this.isMultiStepTask()
        ? ` (步骤 ${(this.task.currentStepIndex || 0) + 1}/${this.task.steps?.length || 1})`
        : '';
      console.log(`[ChatGPT Adapter] 内容已提交${stepInfo}:`, this.task.id);

      // 开始监控回复完成
      this.startMonitoring();

      return true;

    } catch (error) {
      console.error('[ChatGPT Adapter] 提交内容失败:', error);
      return false;
    }
  }

  // 存储监控相关变量
  private lastResponseLength = 0;
  private stableCheckCount = 0;
  private monitoringInterval: number | null = null;
  private mutationObserver: MutationObserver | null = null;
  private lastMutationTime = 0;

  /**
   * 发送调试日志
   */
  private sendDebugLog(level: 'info' | 'success' | 'warning' | 'error', message: string) {
    chrome.runtime.sendMessage({
      type: 'DEBUG_LOG',
      level,
      message
    });
  }

  // 增加状态追踪
  private hasSeenBusyState = false;

  /**
   * 检查任务状态
   * AIDEV-NOTE: ChatGPT 通过检测停止按钮来判断是否在生成中
   * 关键改进：'idle' 状态（无停止按钮+提交按钮禁用）= 生成完毕
   */
  async checkStatus(): Promise<TaskStatus> {
    try {
      // 优先检查错误信息
      const errorElement = document.querySelector('[role="alert"], .error-message');
      if (errorElement) {
        const errorText = errorElement.textContent?.trim() || '未知错误';
        this.sendDebugLog('error', `❌ 检测到错误: ${errorText}`);
        this.stopMonitoring();
        return TaskStatus.FAILED;
      }

      const composerState = this.getComposerState();

      if (composerState === 'streaming') {
        this.sendDebugLog('info', '⏳ 检测到停止按钮，正在生成...');
        this.hasSeenBusyState = true;  // 记录已进入生成状态
        this.stableCheckCount = 0;
        return TaskStatus.RUNNING;
      }

      // AIDEV-NOTE: 关键修复 - 'idle' 或 'ready' 状态都表示生成完毕
      // 'idle' = 停止按钮消失 + 提交按钮禁用（输入框空）= 生成完毕，待输入
      // 'ready' = 停止按钮消失 + 提交按钮可用（输入框有内容）= 生成完毕
      if (this.hasSeenBusyState) {
        // 只有之前进入过生成状态，现在退出，才判定完成
        if (composerState === 'idle') {
          this.sendDebugLog('success', '✅ 停止按钮消失，页面已空闲（提交按钮禁用），生成完成');
          this.hasSeenBusyState = false;
          this.stopMonitoring();
          return TaskStatus.COMPLETED;
        }

        if (composerState === 'ready') {
          this.sendDebugLog('success', '✅ 提交按钮已激活，生成完成');
          this.hasSeenBusyState = false;
          this.stopMonitoring();
          return TaskStatus.COMPLETED;
        }
      }

      // 备用检测：检查加载指示器
      const loadingIndicator = document.querySelector(ChatGPTAdapter.SELECTORS.loadingIndicator);
      if (loadingIndicator) {
        const display = window.getComputedStyle(loadingIndicator).display;
        if (display !== 'none') {
          this.sendDebugLog('info', '⏳ 检测到加载指示器...');
          this.hasSeenBusyState = true;
          return TaskStatus.RUNNING;
        }
      }

      // 文本稳定性检测（兜底）
      const latestResponse = document.querySelector(ChatGPTAdapter.SELECTORS.latestResponse);
      if (!latestResponse) {
        // 还没有响应，但也没有停止按钮，可能刚提交还没开始
        this.sendDebugLog('info', '⏳ 等待响应出现...');
        return TaskStatus.RUNNING;
      }

      const currentLength = latestResponse.textContent?.trim().length || 0;

      if (currentLength === this.lastResponseLength && currentLength > 0) {
        this.stableCheckCount++;
        this.sendDebugLog('info', `⏳ 响应稳定检测: ${this.stableCheckCount}/3`);

        if (this.stableCheckCount >= 3) {
          this.sendDebugLog('success', '✅ 响应稳定，判定完成');
          this.stopMonitoring();
          return TaskStatus.COMPLETED;
        }
      } else {
        this.stableCheckCount = 0;
      }

      this.lastResponseLength = currentLength;

      return TaskStatus.RUNNING;

    } catch (error) {
      console.error('[ChatGPT Adapter] 检查状态失败:', error);
      this.sendDebugLog('error', `❌ 检查状态异常`);
      return TaskStatus.FAILED;
    }
  }

  /**
   * 开始监控回复完成
   */
  private startMonitoring(): void {
    console.log('[ChatGPT Adapter] 开始监控回复完成');
    this.lastResponseLength = 0;
    this.stableCheckCount = 0;
    this.lastMutationTime = Date.now();

    let messagesContainer = document.querySelector(ChatGPTAdapter.SELECTORS.messagesContainer);

    // 如果找不到指定的容器，尝试寻找一个具体的对话 turn 并使用其父级
    if (!messagesContainer) {
      const anyTurn = document.querySelector('[data-testid="conversation-turn"], article');
      if (anyTurn && anyTurn.parentElement) {
        messagesContainer = anyTurn.parentElement;
        this.sendDebugLog('info', '🧩 采用自动探测的消息容器');
      }
    }

    if (!messagesContainer) {
      // 仍然找不到，兜底使用 main
      const main = document.querySelector('main');
      if (main) {
        messagesContainer = main;
        this.sendDebugLog('info', '🧩 采用 main 作为消息容器兜底');
      }
    }

    if (!messagesContainer) {
      this.sendDebugLog('warning', '⚠️ 找不到消息容器，将完全依赖轮询判断状态');
      return;
    }

    // 创建 MutationObserver 监听 DOM 变化
    this.mutationObserver = new MutationObserver(() => {
      this.lastMutationTime = Date.now();
      this.sendDebugLog('info', '🔄 检测到响应内容变化...');
    });

    this.mutationObserver.observe(messagesContainer, {
      childList: true,
      subtree: true,
      characterData: true
    });

    this.sendDebugLog('success', '✅ 已启动 DOM 变化监听');
  }

  /**
   * 停止监控
   */
  private stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
      this.sendDebugLog('info', '🛑 已停止 DOM 变化监听');
    }

    console.log('[ChatGPT Adapter] 停止监控');
  }

  /**
   * 获取生成结果
   */
  async getResult(): Promise<any> {
    const latestResponse = document.querySelector(ChatGPTAdapter.SELECTORS.latestResponse);
    return {
      text: latestResponse?.textContent?.trim() || '',
      html: latestResponse?.innerHTML || ''
    };
  }

  /**
   * AIDEV-NOTE: 清理和重置（为多步骤任务做准备）
   * 在多步骤任务中，每个步骤完成后调用此方法
   */
  async cleanup(): Promise<void> {
    // 停止所有监控
    this.stopMonitoring();

    // 重置监控状态
    this.lastResponseLength = 0;
    this.stableCheckCount = 0;
    this.lastMutationTime = 0;
    this.hasSeenBusyState = false;

    // 清空输入框
    try {
      const inputBox = this.findVisibleInputBox();
      if (inputBox) {
        this.fillInputBox(inputBox, '');
        this.dispatchInputEvents(inputBox, '');
        this.sendDebugLog('info', '🧹 输入框已清空');
      }
    } catch (error) {
      console.warn('[ChatGPT Adapter] 清空输入框失败:', error);
    }

    // 等待页面状态稳定
    await this.sleep(500);

    console.log('[ChatGPT Adapter] 清理完成，准备执行下一步');
  }

  /**
   * 辅助方法：延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 将内容写入输入框，兼容 textarea 与 ProseMirror contenteditable
   */
  private fillInputBox(inputBox: HTMLElement, content: string): void {
    if (inputBox instanceof HTMLTextAreaElement) {
      inputBox.value = content;
      inputBox.focus();
      this.moveCaretToEnd(inputBox);
      this.logInputPreview(inputBox);
      return;
    }

    if (inputBox.isContentEditable) {
      inputBox.focus();
      this.selectAllContent(inputBox);

      if (!content) {
        inputBox.innerHTML = '<p><br class="ProseMirror-trailingBreak"></p>';
        this.moveCaretToEnd(inputBox);
        this.logInputPreview(inputBox);
        return;
      }

      const inserted = this.pasteViaClipboardEvent(inputBox, content) || this.insertTextViaCommand(content);
      if (!inserted || !this.didContentAppear(inputBox, content)) {
        this.replaceContentEditableContent(inputBox, content);
      }

      this.moveCaretToEnd(inputBox);
      this.logInputPreview(inputBox);
      return;
    }

    inputBox.textContent = content;
    this.logInputPreview(inputBox);
  }

  /**
   * 触发输入相关事件，让页面响应内容变更
   */
  private dispatchInputEvents(target: HTMLElement, content: string): void {
    if (typeof window !== 'undefined') {
      const InputEventConstructor = window.InputEvent;
      if (typeof InputEventConstructor === 'function') {
        const inputEvent = new InputEventConstructor('input', {
          bubbles: true,
          data: content,
          inputType: 'insertText'
        });
        target.dispatchEvent(inputEvent);
      } else {
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }

    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * 将光标移动到输入框末尾
   */
  private moveCaretToEnd(target: HTMLElement): void {
    if (target instanceof HTMLTextAreaElement) {
      const length = target.value.length;
      target.selectionStart = length;
      target.selectionEnd = length;
      return;
    }

    if (typeof window === 'undefined') return;

    if (target.isContentEditable) {
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  /**
   * 使用标准段落结构替换 contenteditable 内容
   */
  private replaceContentEditableContent(target: HTMLElement, content: string): void {
    const paragraph = document.createElement('p');
    paragraph.append(document.createTextNode(content));
    const trailingBreak = document.createElement('br');
    trailingBreak.classList.add('ProseMirror-trailingBreak');
    paragraph.append(trailingBreak);
    target.innerHTML = '';
    target.append(paragraph);
  }

  /**
   * 选中输入框内所有内容（用于覆盖 placeholder）
   */
  private selectAllContent(target: HTMLElement): void {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  /**
   * 通过 execCommand 插入文本，尽量模拟真实输入
   */
  private insertTextViaCommand(content: string): boolean {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
      return false;
    }
    try {
      const success = document.execCommand('insertText', false, content);
      return success;
    } catch (error) {
      console.warn('[ChatGPT Adapter] execCommand 插入失败:', error);
      return false;
    }
  }

  /**
   * 优先返回当前可见输入框，避免命中隐藏状态 DOM
   */
  private findVisibleInputBox(): HTMLElement | null {
    const candidates: HTMLElement[] = [];
    const composerForm = document.querySelector(ChatGPTAdapter.SELECTORS.composerForm);

    if (composerForm) {
      candidates.push(
        ...Array.from(
          composerForm.querySelectorAll(ChatGPTAdapter.SELECTORS.inputBox) as NodeListOf<HTMLElement>
        )
      );
    }

    if (!candidates.length) {
      candidates.push(
        ...Array.from(document.querySelectorAll(ChatGPTAdapter.SELECTORS.inputBox) as NodeListOf<HTMLElement>)
      );
    }

    if (!candidates.length) return null;

    this.sendDebugLog('info', `🔢 检测到输入框候选: ${candidates.length} 个`);

    const visibleNode = candidates.find(node => this.isElementVisible(node));
    if (visibleNode) {
      this.sendDebugLog('info', `🎯 选中了可见输入框: ${this.describeElement(visibleNode)}`);
      return visibleNode;
    }

    this.sendDebugLog('warning', `⚠️ 未发现可见输入框，候选数量: ${candidates.length}`);
    return candidates[0];
  }

  /**
   * 判断元素是否可见
   */
  private isElementVisible(node: HTMLElement): boolean {
    if (typeof window === 'undefined') return true;
    const style = window.getComputedStyle(node);
    const hiddenByCSS = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    const hiddenBySize = node.offsetParent === null && style.position !== 'fixed';
    return !hiddenByCSS && !hiddenBySize;
  }

  /**
   * 记录输入框中的部分内容，便于调试
   */
  private logInputPreview(target: HTMLElement): void {
    const preview = target.textContent?.trim().slice(0, 40) || '(空)';
    this.sendDebugLog('info', `📝 输入框内容预览: ${preview}`);
  }

  /**
   * 触发粘贴事件，交给 ProseMirror 原生粘贴逻辑处理
   */
  private pasteViaClipboardEvent(target: HTMLElement, content: string): boolean {
    if (
      typeof window === 'undefined' ||
      typeof window.ClipboardEvent === 'undefined' ||
      typeof window.DataTransfer === 'undefined'
    ) {
      return false;
    }

    try {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', content);

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true
      });

      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: clipboardData,
        writable: false
      });

      target.dispatchEvent(pasteEvent);
      return true;
    } catch (error) {
      console.warn('[ChatGPT Adapter] 触发粘贴事件失败:', error);
      return false;
    }
  }

  /**
   * 粘贴/输入后检测 DOM 是否已经出现目标内容
   */
  private didContentAppear(target: HTMLElement, expected: string): boolean {
    const text = target.textContent?.trim() || '';
    return expected ? text.includes(expected.trim()) : text.length === 0;
  }

  /**
    * 停止当前任务：优先尝试点击停止按钮
    */
  async stopCurrentTask(): Promise<void> {
    try {
      const stopButton = document.querySelector(ChatGPTAdapter.SELECTORS.stopButton) as HTMLButtonElement | null;
      if (stopButton && this.isButtonEnabled(stopButton)) {
        this.sendDebugLog('info', '⏹ 检测到停止按钮，正在尝试终止生成...');
        stopButton.click();
        await this.sleep(300);
        this.sendDebugLog('success', '✅ 已点击停止按钮');
      } else {
        this.sendDebugLog('warning', '⚠️ 当前未找到停止按钮，直接执行清理');
      }
    } catch (error) {
      console.warn('[ChatGPT Adapter] 停止任务时出错:', error);
    } finally {
      await super.stopCurrentTask();
    }
  }

  /**
   * 打印元素的简要描述，便于日志定位
   */
  private describeElement(node: HTMLElement): string {
    const id = node.id ? `#${node.id}` : '';
    const classes = node.classList.length ? `.${Array.from(node.classList).join('.')}` : '';
    return `${node.tagName.toLowerCase()}${id}${classes}`;
  }

  /**
   * 轮询等待元素出现
   */
  private waitForElement<T extends Element>(selector: string, timeout = 4000, interval = 100): Promise<T | null> {
    const start = Date.now();
    return new Promise(resolve => {
      const check = () => {
        const element = document.querySelector(selector) as T | null;
        if (element) {
          resolve(element);
          return;
        }

        if (Date.now() - start >= timeout) {
          resolve(null);
          return;
        }

        setTimeout(check, interval);
      };

      check();
    });
  }

  /**
   * 判断 ChatGPT composer 当前所处状态
   */
  private getComposerState(): 'idle' | 'ready' | 'streaming' {
    const stopButton = document.querySelector(ChatGPTAdapter.SELECTORS.stopButton);
    if (stopButton) {
      return 'streaming';
    }

    const submitButton = document.querySelector(ChatGPTAdapter.SELECTORS.submitButton) as HTMLButtonElement | null;
    if (submitButton && this.isButtonEnabled(submitButton)) {
      return 'ready';
    }

    return 'idle';
  }

  /**
   * 检查按钮是否可点击（兼容 aria-disabled）
   */
  private isButtonEnabled(button: HTMLButtonElement): boolean {
    const ariaDisabled = button.getAttribute('aria-disabled');
    return !button.disabled && ariaDisabled !== 'true';
  }
}
