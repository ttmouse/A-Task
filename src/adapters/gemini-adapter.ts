// [IN]: DOM (Gemini), BaseAdapter
// [OUT]: DOM Manipulation (Input/Submit), Status Monitoring
// [POS]: Adapters Layer / Concrete Implementation (Gemini)
// Protocol: When updated, sync this header + src/adapters/.folder.md

import { BaseAdapter } from './base-adapter.js';
import { TaskStatus } from '../types/task.js';

type InputState = 'unknown' | 'idle' | 'ready' | 'waiting' | 'busy' | 'error' | 'blocked';

// AIDEV-NOTE: Gemini 适配器实现
// 需要根据实际页面结构调整选择器和监控逻辑

export class GeminiAdapter extends BaseAdapter {
  // AIDEV-NOTE: 根据实际 Gemini 页面结构确定的选择器
  private static readonly SELECTORS = {
    // 输入框选择器 - rich-textarea 内的 contenteditable div
    inputBox: 'rich-textarea .ql-editor[contenteditable="true"]',
    // 提交/停止按钮选择器 - 同一个按钮，根据状态切换
    submitButton: 'button.send-button',
    // 发送按钮容器 - 用于检测 disabled/visible 状态
    submitButtonContainer: '.send-button-container',
    // 检测是否在生成中：按钮包含 'stop' class
    stopButton: 'button.send-button.stop',
    // 消息容器选择器 - Gemini 对话消息显示区域
    messagesContainer: 'message-set, .conversation-container, [role="presentation"]',
    // 最新响应选择器
    latestResponse: 'message-content:last-child, .model-response:last-child',
    // 加载状态指示器
    loadingIndicator: '.spinner, [aria-label*="正在生成"], [aria-busy="true"]'
  };

  /**
   * AIDEV-NOTE: 提交内容到 Gemini（支持多步骤任务）
   * @param content 要提交的内容（当前步骤内容或完整 prompt）
   */
  async submitContent(content: string): Promise<boolean> {
    try {
      this.sendDebugLog('info', '🔍 检查页面是否空闲...');
      this.notifyInputStatus('waiting', '等待页面空闲');
      const isIdle = await this.waitForPageIdle();
      if (!isIdle) {
        this.sendDebugLog('error', '❌ 页面一直处于生成状态，暂时无法提交新任务');
        this.notifyInputStatus('blocked', '页面仍在生成，暂无法输入');
        return false;
      }

      this.sendDebugLog('success', '✅ 页面空闲，开始准备提交任务');
      this.notifyInputStatus('ready', '页面空闲，准备输入内容');

      // 查找输入框
      this.sendDebugLog('info', '🔍 正在查找输入框...');
      const inputBox = document.querySelector(GeminiAdapter.SELECTORS.inputBox) as HTMLElement;
      if (!inputBox) {
        this.sendDebugLog('error', '❌ 找不到输入框，请检查选择器');
        this.notifyInputStatus('error', '找不到输入框');
        throw new Error('找不到 Gemini 输入框');
      }
      this.sendDebugLog('success', '✅ 输入框定位成功');

      // 清空输入框
      inputBox.innerHTML = '';

      // 输入内容 - 使用 textContent 而不是 innerHTML 避免注入
      this.sendDebugLog('info', '📝 正在输入内容...');
      inputBox.textContent = content;

      // 触发输入事件
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      inputBox.dispatchEvent(new Event('change', { bubbles: true }));
      this.sendDebugLog('success', `✅ 内容已输入 (${content.length} 字符)`);

      // 等待一下让输入生效
      await this.sleep(800);

      // 查找并点击提交按钮
      this.sendDebugLog('info', '🔍 正在查找提交按钮...');
      const submitButton = document.querySelector(GeminiAdapter.SELECTORS.submitButton) as HTMLButtonElement;
      if (!submitButton) {
        this.sendDebugLog('error', '❌ 找不到提交按钮，请检查选择器');
        this.notifyInputStatus('error', '找不到提交按钮');
        throw new Error('找不到 Gemini 提交按钮');
      }

      // 检查按钮是否可用
      if (submitButton.disabled || submitButton.getAttribute('aria-disabled') === 'true') {
        this.sendDebugLog('warning', '⚠️ 提交按钮不可用，可能输入内容为空');
        this.notifyInputStatus('blocked', '提交按钮不可用');
        throw new Error('提交按钮不可用，可能输入内容为空');
      }

      this.sendDebugLog('success', '✅ 提交按钮定位成功');
      submitButton.click();
      this.sendDebugLog('success', '✅ 已点击提交按钮');
      this.notifyInputStatus('busy', '任务已提交，等待 Gemini 响应');

      // 如果是多步骤任务，记录当前步骤
      const stepInfo = this.isMultiStepTask()
        ? ` (步骤 ${(this.task.currentStepIndex || 0) + 1}/${this.task.steps?.length || 1})`
        : '';
      console.log(`[Gemini Adapter] 内容已提交${stepInfo}:`, this.task.id);

      // 开始监控回复完成
      this.startMonitoring();

      return true;

    } catch (error) {
      console.error('[Gemini Adapter] 提交内容失败:', error);
      return false;
    }
  }

  // 存储监控相关变量
  private lastResponseLength = 0;
  private stableCheckCount = 0;
  private buttonStableCount = 0;  // 新增：停止按钮消失的稳定次数
  private monitoringInterval: number | null = null;
  private mutationObserver: MutationObserver | null = null;
  private lastMutationTime = 0;
  private completionCheckTimer: number | null = null;
  private hasSeenBusyState = false;
  private currentInputState: InputState = 'unknown';
  private lastInputDetail?: string;
  private _lastSilentLog = 0;

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

  private notifyInputStatus(state: InputState, detail?: string) {
    const normalizedDetail = detail || '';
    if (this.currentInputState === state && normalizedDetail === (this.lastInputDetail || '')) {
      return;
    }
    this.currentInputState = state;
    this.lastInputDetail = normalizedDetail || undefined;

    chrome.runtime.sendMessage({
      type: 'INPUT_STATUS_UPDATE',
      state,
      detail,
      timestamp: Date.now()
    });
  }

  // AIDEV-NOTE: Flag set by MutationObserver when it detects stability
  private observerConfirmedIdle = false;

  /**
   * 检查任务状态
   * AIDEV-NOTE: 使用停止按钮状态 + 按钮容器状态 + 文本稳定性作为主要检测方法
   */
  async checkStatus(): Promise<TaskStatus> {
    try {
      // 0. Base check: MutationObserver confirmed idle
      if (this.observerConfirmedIdle) {
        this.sendDebugLog('success', '🎉 DOM 监听确认页面已稳定且空闲');
        this.stopMonitoring();
        this.notifyInputStatus('idle', '任务完成，页面空闲');
        return TaskStatus.COMPLETED;
      }

      // AIDEV-NOTE: 第一层检测 - 检查停止按钮（最可靠的指标）
      // ... (rest of checkStatus logic remains similar, but we can rely on observerConfirmedIdle for speed)

      // ... existing checks ...

      const stopButton = document.querySelector(GeminiAdapter.SELECTORS.stopButton) as HTMLButtonElement | null;
      const submitButton = document.querySelector(GeminiAdapter.SELECTORS.submitButton) as HTMLButtonElement | null;
      const isStopVisible = (btn: HTMLElement | null) =>
        btn && this.isElementVisible(btn) &&
        ((btn.classList.contains('stop')) ||
          (btn.getAttribute('aria-label') || '').includes('停止') ||
          (btn.getAttribute('aria-label') || '').toLowerCase().includes('stop'));

      if (isStopVisible(stopButton) || isStopVisible(submitButton)) {
        const label = (stopButton || submitButton)?.getAttribute('aria-label');
        this.sendDebugLog('info', `⏳ 检测到停止按钮 (${label || '停止回答'})，AI 正在生成...`);
        this.hasSeenBusyState = true;
        this.stableCheckCount = 0;
        this.buttonStableCount = 0;
        this.observerConfirmedIdle = false; // Reset flag if we see busy state
        return TaskStatus.RUNNING;
      }

      // AIDEV-NOTE: 简化逻辑 - 没有停止按钮 = 生成完毕
      // 如果之前进入过生成状态，现在停止按钮消失了，就是完成
      if (this.hasSeenBusyState) {
        this.sendDebugLog('success', '🎉 停止按钮消失，页面已返回待输入状态');
        this.stopMonitoring();
        this.notifyInputStatus('idle', '任务完成，页面空闲');
        return TaskStatus.COMPLETED;
      }

      // 还没进入过生成状态，可能刚提交还没开始
      this.sendDebugLog('info', '⏳ 等待 AI 开始生成...');
      return TaskStatus.RUNNING;

    } catch (error) {
      console.error('[Gemini Adapter] 检查状态失败:', error);
      return TaskStatus.FAILED;
    }
  }

  // ... startMonitoring ...

  /**
   * DOM 稳定后检查是否完成
   */
  private async checkCompletionAfterStable(): Promise<void> {
    const timeSinceLastMutation = Date.now() - this.lastMutationTime;

    // 如果距离最后一次变化已经超过 3 秒，认为可能已完成
    if (timeSinceLastMutation >= 3000) {
      // Check stop button first - MUST use isElementVisible
      const stopButton = document.querySelector(GeminiAdapter.SELECTORS.stopButton) as HTMLElement;
      if (stopButton && this.isElementVisible(stopButton)) {
        // Double check it's actually a stop button (logic copied from checkStatus)
        const isRealStop = stopButton.classList.contains('stop') ||
          (stopButton.getAttribute('aria-label') || '').includes('停止') ||
          (stopButton.getAttribute('aria-label') || '').toLowerCase().includes('stop');

        if (isRealStop) {
          this.sendDebugLog('warning', '⚠️ 停止按钮还存在 (可见)，AI 仍在生成中，不能判定完成');
          return; // Still running
        }
      }

      // Check submit button - In Gemini, if it exists and is NOT a stop button, we're done
      // The button being disabled (input empty) is FINE - that's the normal idle state after generation!
      const submitButton = document.querySelector(GeminiAdapter.SELECTORS.submitButton) as HTMLButtonElement;
      if (!submitButton) return; // No button at all, can't determine state

      // If button has 'stop' class, it's still generating (this shouldn't happen if stopButton wasn't found above)
      if (submitButton.classList.contains('stop')) {
        this.sendDebugLog('warning', '⚠️ 发送按钮有 stop 类，AI 仍在生成');
        return;
      }

      // Loading indicator
      const loadingIndicator = document.querySelector(GeminiAdapter.SELECTORS.loadingIndicator);
      if (loadingIndicator && window.getComputedStyle(loadingIndicator).display !== 'none') {
        return;
      }

      // All good - Set flag (button exists, no stop class, no loading indicator)
      this.sendDebugLog('success', '🎉 (Observer) 停止按钮消失，页面已返回待输入状态');
      this.observerConfirmedIdle = true;

      // DO NOT call stopMonitoring() here, let checkStatus do it
      // DO NOT send message to background
    }
  }

  /**
   * 开始监控回复完成
   */
  private startMonitoring(): void {
    console.log('[Gemini Adapter] 开始监控回复完成 (MutationObserver)');
    this.lastResponseLength = 0;
    this.stableCheckCount = 0;
    this.buttonStableCount = 0;
    this.lastMutationTime = Date.now();
    this.hasSeenBusyState = false;
    this.observerConfirmedIdle = false; // Reset flag

    // 查找响应容器
    const messagesContainer = document.querySelector(GeminiAdapter.SELECTORS.messagesContainer);
    if (!messagesContainer) {
      this.sendDebugLog('warning', '⚠️ 找不到消息容器，使用轮询方式监控');
      return;
    }

    // AIDEV-NOTE: 创建 MutationObserver 监听 DOM 变化
    this.mutationObserver = new MutationObserver((mutations) => {
      // 有变化发生，更新最后变化时间
      this.lastMutationTime = Date.now();
      this.sendDebugLog('info', '🔄 检测到响应内容变化...');

      // 清除之前的定时器
      if (this.completionCheckTimer) {
        clearTimeout(this.completionCheckTimer);
      }

      // AIDEV-NOTE: DOM 停止变化 3 秒后检查是否完成
      this.completionCheckTimer = window.setTimeout(() => {
        this.checkCompletionAfterStable();
      }, 3000);
    });

    // 开始观察
    this.mutationObserver.observe(messagesContainer, {
      childList: true,      // 监听子节点添加/删除
      subtree: true,        // 监听所有后代节点
      characterData: true,  // 监听文本内容变化
      attributes: true,     // 监听属性变化
      attributeFilter: ['aria-busy', 'class'] // 只监听特定属性
    });

    this.sendDebugLog('success', '✅ 已启动 DOM 变化监听 (MutationObserver)');

    // Fallback: Trigger a manual check after 5 seconds if no mutations seen
    setTimeout(() => {
      if (!this.lastMutationTime || this.lastMutationTime < Date.now() - 4000) {
        console.log('[Gemini Adapter] Fallback: No mutations detected recently, forcing check.');
        this.checkCompletionAfterStable();
      }
    }, 5000);
  }

  /**
   * 停止监控
   */
  private stopMonitoring(): void {
    // 停止轮询
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    // 停止 MutationObserver
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
      this.sendDebugLog('info', '🛑 已停止 DOM 变化监听');
    }

    // 清除定时器
    if (this.completionCheckTimer) {
      clearTimeout(this.completionCheckTimer);
      this.completionCheckTimer = null;
    }
    this.hasSeenBusyState = false;

    console.log('[Gemini Adapter] 停止监控');
  }

  /**
   * 检测页面是否仍在生成
   */
  private detectPageBusyState(includeStopButton = true): { busy: boolean; detail?: string } {
    if (includeStopButton) {
      const stopButton = document.querySelector(GeminiAdapter.SELECTORS.stopButton) as HTMLButtonElement | null;
      const submitButton = document.querySelector(GeminiAdapter.SELECTORS.submitButton) as HTMLButtonElement | null;
      const stopCandidate = this.isElementVisible(stopButton)
        ? stopButton
        : (submitButton && this.isElementVisible(submitButton) &&
          ((submitButton.classList.contains('stop')) ||
            (submitButton.getAttribute('aria-label') || '').includes('停止') ||
            (submitButton.getAttribute('aria-label') || '').toLowerCase().includes('stop')))
          ? submitButton
          : null;
      if (stopCandidate) {
        const label = stopCandidate.getAttribute('aria-label');
        return {
          busy: true,
          detail: label ? `检测到“${label}”按钮，说明 Gemini 正在生成中` : '检测到“停止回答”按钮，Gemini 正在生成中'
        };
      }
    }
    const loadingIndicator = document.querySelector(GeminiAdapter.SELECTORS.loadingIndicator) as HTMLElement | null;
    if (loadingIndicator && this.isElementVisible(loadingIndicator)) {
      const styles = window.getComputedStyle(loadingIndicator);
      if (styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0') {
        return {
          busy: true,
          detail: '检测到加载指示器，Gemini 正在生成响应'
        };
      }
    }

    return { busy: false };
  }

  private isElementVisible(element: Element | null): boolean {
    if (!element) return false;
    const el = element as HTMLElement;
    const styles = window.getComputedStyle(el);
    if (styles.display === 'none' || styles.visibility === 'hidden' || styles.opacity === '0') {
      return false;
    }
    if (el.offsetParent === null && styles.position !== 'fixed') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * 等待页面空闲后再提交内容
   */
  private async waitForPageIdle(timeout = 60000, interval = 1000): Promise<boolean> {
    const startTime = Date.now();
    let lastLogTime = 0;

    while (Date.now() - startTime < timeout) {
      const state = this.detectPageBusyState();
      if (!state.busy) {
        this.notifyInputStatus('ready', '页面空闲，准备输入');
        return true;
      }

      this.notifyInputStatus('waiting', state.detail || '等待页面空闲');
      if (Date.now() - lastLogTime > 4000) {
        this.sendDebugLog('info', state.detail ? `⏳ ${state.detail}` : '⏳ Gemini 仍在生成，等待空闲...');
        lastLogTime = Date.now();
      }

      await this.sleep(interval);
    }

    this.notifyInputStatus('blocked', '页面长时间繁忙，提交取消');
    return false;
  }

  /**
   * 获取生成结果
   */
  async getResult(): Promise<any> {
    const latestResponse = document.querySelector(GeminiAdapter.SELECTORS.latestResponse);
    return {
      text: latestResponse?.textContent?.trim() || '',
      html: latestResponse?.innerHTML || ''
    };
  }

  /**
   * AIDEV-NOTE: 清理和重置（为多步骤任务做准备）
   * 在多步骤任务中，每个步骤完成后调用此方法
   * 清理：停止监控、重置状态、清空输入框
   */
  async cleanup(): Promise<void> {
    // 停止所有监控
    this.stopMonitoring();

    // 重置监控状态
    this.lastResponseLength = 0;
    this.stableCheckCount = 0;
    this.buttonStableCount = 0;  // 重置按钮稳定计数器
    this.lastMutationTime = 0;

    // 清空输入框，为下一步做准备
    try {
      const inputBox = document.querySelector(GeminiAdapter.SELECTORS.inputBox) as HTMLElement;
      if (inputBox) {
        inputBox.innerHTML = '';
        inputBox.textContent = '';
        this.sendDebugLog('info', '🧹 输入框已清空');
      }
    } catch (error) {
      console.warn('[Gemini Adapter] 清空输入框失败:', error);
    }

    // 等待一小段时间，确保页面状态稳定
    await this.sleep(500);

    console.log('[Gemini Adapter] 清理完成，准备执行下一步');
    this.notifyInputStatus('idle', '输入已重置');
  }

  /**
   * 辅助方法：延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
