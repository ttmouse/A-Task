// INPUT: ./base-adapter.js (BaseAdapter 基类), ../types/task.js (TaskStatus)
// OUTPUT: GeminiAdapter 类，实现 Gemini 网站的任务提交、状态检查、结果获取
// POS: 具体适配器实现，被 AdapterFactory 创建，在 Gemini 页面的 content script 中使用
// 一旦本文件被修改，请更新此注释并同步更新 /src/adapters/README.md

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

  /**
   * 检查任务状态
   * AIDEV-NOTE: 使用停止按钮状态 + 按钮容器状态 + 文本稳定性作为主要检测方法
   *
   * 关键改进：
   * 1. 增加按钮容器状态检测（disabled/visible class）
   * 2. 增加稳定性检查次数（3→5次），更保守
   * 3. 多重确认机制，避免过早判定
   */
  async checkStatus(): Promise<TaskStatus> {
    try {
      // AIDEV-NOTE: 第一层检测 - 检查停止按钮（最可靠的指标）
      // 生成中：按钮有 'stop' class，显示"停止回答"
      // 完成后：按钮切换回发送状态，没有 'stop' class

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
        this.hasSeenBusyState = true; // 记录已经进入过生成状态
        this.stableCheckCount = 0; // 重置文本稳定计数器
        this.buttonStableCount = 0; // 重置按钮稳定计数器
        return TaskStatus.RUNNING;
      }

      // AIDEV-NOTE: 停止按钮已经消失，进一步确认页面是否空闲

      const busyState = this.detectPageBusyState(false);
      if (busyState.busy) {
        this.hasSeenBusyState = true;
        this.sendDebugLog('info', busyState.detail || '⏳ 检测到页面仍在生成，继续等待...');
        this.buttonStableCount = 0;
        return TaskStatus.RUNNING;
      }

      if (this.hasSeenBusyState) {
        this.sendDebugLog('success', '🎉 停止按钮消失，页面已返回待输入状态');
        this.hasSeenBusyState = false;
        this.stopMonitoring();
        this.notifyInputStatus('idle', '任务完成，页面空闲');
        return TaskStatus.COMPLETED;
      }

      // 仍未检测到停止按钮（或页面从未进入过忙碌状态），退回到文本稳定性检测

      if (!submitButton) {
        this.sendDebugLog('warning', '⚠️ 找不到发送按钮，尝试通过响应文本判断状态...');
      }

      const submitButtonContainer = document.querySelector(GeminiAdapter.SELECTORS.submitButtonContainer);
      if (!submitButtonContainer) {
        this.sendDebugLog('warning', '⚠️ 找不到发送按钮容器，尝试通过响应文本判断状态...');
      }

      // AIDEV-NOTE: 第三层检测 - 检查响应文本的稳定性

      const latestResponse = document.querySelector(GeminiAdapter.SELECTORS.latestResponse);
      if (!latestResponse) {
        this.sendDebugLog('warning', '⚠️ 找不到响应内容，继续等待...');
        this.buttonStableCount = 0;
        return TaskStatus.RUNNING;
      }

      const currentLength = latestResponse.textContent?.trim().length || 0;

      // 文本长度是否稳定（连续多次没有变化）
      if (currentLength === this.lastResponseLength && currentLength > 0) {
        this.stableCheckCount++;
        this.sendDebugLog('info', `⏳ 响应文本稳定: ${this.stableCheckCount}/5 次 (长度: ${currentLength})`);
      } else {
        if (this.lastResponseLength > 0 && currentLength > this.lastResponseLength) {
          this.sendDebugLog('info', `⏳ 响应文本仍在增长: ${this.lastResponseLength} → ${currentLength}`);
        }
        this.stableCheckCount = 0;
        this.buttonStableCount = 0; // 文本还在变化，重置按钮计数
      }

      this.lastResponseLength = currentLength;

      // AIDEV-NOTE: 第四层检测 - 按钮状态也需要连续稳定多次（提高到5次，更保守）
      if (this.stableCheckCount >= 5) {
        if (!submitButton || !submitButtonContainer) {
          this.sendDebugLog('success', '🎉 响应文本已稳定且停止按钮消失，即使当前只显示麦克风也判定完成');
          this.stopMonitoring();
          this.notifyInputStatus('idle', '任务完成，页面空闲');
          return TaskStatus.COMPLETED;
        }

        this.buttonStableCount++;
        this.sendDebugLog('info', `✅ 按钮稳定检测: ${this.buttonStableCount}/5 次`);

        // AIDEV-NOTE: 同时满足所有条件才判定完成：
        // - 文本连续 5 次稳定（10秒，从6秒增加到10秒）
        // - 按钮区域连续 5 次稳定（如果存在发送按钮）
        // - 停止按钮已消失（最关键的检查）
        if (this.buttonStableCount >= 5) {
          // 最后多重确认
          const finalStopButtonCheck = document.querySelector(GeminiAdapter.SELECTORS.stopButton) as HTMLElement | null;
          const stopStillVisible = finalStopButtonCheck && this.isElementVisible(finalStopButtonCheck);
          if (stopStillVisible) {
            this.sendDebugLog('warning', '⚠️ 最后检查发现停止按钮还在，重置计数器');
            this.buttonStableCount = 0;
            this.stableCheckCount = 0;
            return TaskStatus.RUNNING;
          }

          // Gemini 在单文本任务完成后会清空输入框，并将发送按钮禁用，此时即便按钮是 disabled 也表示可以再次输入
          const isSubmitDisabled = submitButton.disabled || submitButton.getAttribute('aria-disabled') === 'true';
          if (isSubmitDisabled) {
            this.sendDebugLog('success', '🎉 生成完成确认！发送按钮已恢复为空闲（禁用状态意味着输入框为空），停止按钮消失');
          } else {
            const ariaLabel = submitButton.getAttribute('aria-label');
            this.sendDebugLog('success', `🎉 生成完成确认！发送按钮 (${ariaLabel}) 已稳定可用，文本已停止增长，停止按钮已消失`);
          }
          this.stopMonitoring();
          this.notifyInputStatus('idle', '任务完成，页面空闲');
          return TaskStatus.COMPLETED;
        }
      }

      // 备用检测：检查加载指示器
      const loadingIndicator = document.querySelector(GeminiAdapter.SELECTORS.loadingIndicator);
      if (loadingIndicator) {
        const display = window.getComputedStyle(loadingIndicator).display;
        if (display !== 'none') {
          this.sendDebugLog('info', '⏳ 检测到加载指示器...');
          this.buttonStableCount = 0;
          return TaskStatus.RUNNING;
        }
      }

      // 检查错误信息
      const errorElement = document.querySelector('[role="alert"], .error-message');
      if (errorElement) {
        const errorText = errorElement.textContent?.trim() || '未知错误';
        this.sendDebugLog('error', `❌ 检测到错误: ${errorText}`);
        this.stopMonitoring();
        return TaskStatus.FAILED;
      }

      return TaskStatus.RUNNING;

    } catch (error) {
      console.error('[Gemini Adapter] 检查状态失败:', error);
      const errorMsg = error instanceof Error ? error.message : '未知错误';
      this.sendDebugLog('error', `❌ 检查状态异常: ${errorMsg}`);
      return TaskStatus.FAILED;
    }
  }

  /**
   * 开始监控回复完成
   * AIDEV-NOTE: 使用 MutationObserver 实时监听 DOM 变化
   */
  private startMonitoring(): void {
    console.log('[Gemini Adapter] 开始监控回复完成 (MutationObserver)');
    this.lastResponseLength = 0;
    this.stableCheckCount = 0;
    this.buttonStableCount = 0;  // 重置按钮稳定计数器
    this.lastMutationTime = Date.now();
    this.hasSeenBusyState = false;

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

    this.sendDebugLog('success', '✅ 已启动 DOM 变化监听');
  }

  /**
   * DOM 稳定后检查是否完成
   * AIDEV-NOTE: 必须先检查停止按钮，这是最可靠的指标
   */
  private async checkCompletionAfterStable(): Promise<void> {
    const timeSinceLastMutation = Date.now() - this.lastMutationTime;

    // 如果距离最后一次变化已经超过 3 秒，认为可能已完成
    if (timeSinceLastMutation >= 3000) {
      this.sendDebugLog('info', '✅ DOM 已稳定 3 秒，检查完成状态...');

      // AIDEV-NOTE: 关键检查 - 停止按钮是否还存在
      // 如果停止按钮还在，说明 AI 还在生成，绝不能判定完成
      const stopButton = document.querySelector(GeminiAdapter.SELECTORS.stopButton);
      if (stopButton) {
        this.sendDebugLog('warning', '⚠️ 停止按钮还存在，AI 仍在生成中，不能判定完成');
        return; // 不判定完成，继续等待
      }

      // 停止按钮消失了，进一步确认
      this.sendDebugLog('info', '✅ 停止按钮已消失，进一步确认...');

      // 检查提交按钮状态
      const submitButton = document.querySelector(GeminiAdapter.SELECTORS.submitButton) as HTMLButtonElement;
      if (!submitButton) {
        this.sendDebugLog('warning', '⚠️ 找不到发送按钮，继续等待...');
        return;
      }

      const isDisabled = submitButton.disabled || submitButton.getAttribute('aria-disabled') === 'true';

      if (isDisabled) {
        // 按钮被禁用，说明还没完成
        this.sendDebugLog('warning', '⚠️ 发送按钮被禁用，继续等待...');
        return;
      }

      // 检查是否还有加载指示器
      const loadingIndicator = document.querySelector(GeminiAdapter.SELECTORS.loadingIndicator);
      if (loadingIndicator && window.getComputedStyle(loadingIndicator).display !== 'none') {
        this.sendDebugLog('warning', '⚠️ 加载指示器还在，继续等待...');
        return;
      }

      // 所有条件都满足：停止按钮消失、发送按钮可用、无加载指示器
      this.sendDebugLog('success', '🎉 所有条件确认，生成真正完成！');
      this.stopMonitoring();

      // 通知 background 任务完成
      chrome.runtime.sendMessage({
        type: 'TASK_STATUS_UPDATE',
        taskId: this.task.id,
        status: TaskStatus.COMPLETED
      });
    }
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
        : (this.isElementVisible(submitButton) &&
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
