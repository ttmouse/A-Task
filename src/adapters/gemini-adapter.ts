import { BaseAdapter } from './base-adapter.js';
import { TaskStatus } from '../types/task.js';

// AIDEV-NOTE: Gemini 适配器实现
// 需要根据实际页面结构调整选择器和监控逻辑

export class GeminiAdapter extends BaseAdapter {
  // AIDEV-NOTE: 根据实际 Gemini 页面结构确定的选择器
  private static readonly SELECTORS = {
    // 输入框选择器 - rich-textarea 内的 contenteditable div
    inputBox: 'rich-textarea .ql-editor[contenteditable="true"]',
    // 提交/停止按钮选择器 - 同一个按钮，根据状态切换
    submitButton: 'button.send-button',
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
   * 提交任务到 Gemini
   */
  async submitTask(): Promise<boolean> {
    try {
      // 查找输入框
      this.sendDebugLog('info', '🔍 正在查找输入框...');
      const inputBox = document.querySelector(GeminiAdapter.SELECTORS.inputBox) as HTMLElement;
      if (!inputBox) {
        this.sendDebugLog('error', '❌ 找不到输入框，请检查选择器');
        throw new Error('找不到 Gemini 输入框');
      }
      this.sendDebugLog('success', '✅ 输入框定位成功');

      // 清空输入框
      inputBox.innerHTML = '';

      // 输入提示词 - 使用 textContent 而不是 innerHTML 避免注入
      this.sendDebugLog('info', '📝 正在输入提示词...');
      inputBox.textContent = this.task.prompt;

      // 触发输入事件
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      inputBox.dispatchEvent(new Event('change', { bubbles: true }));
      this.sendDebugLog('success', `✅ 提示词已输入 (${this.task.prompt.length} 字符)`);

      // 等待一下让输入生效
      await this.sleep(800);

      // 查找并点击提交按钮
      this.sendDebugLog('info', '🔍 正在查找提交按钮...');
      const submitButton = document.querySelector(GeminiAdapter.SELECTORS.submitButton) as HTMLButtonElement;
      if (!submitButton) {
        this.sendDebugLog('error', '❌ 找不到提交按钮，请检查选择器');
        throw new Error('找不到 Gemini 提交按钮');
      }

      // 检查按钮是否可用
      if (submitButton.disabled || submitButton.getAttribute('aria-disabled') === 'true') {
        this.sendDebugLog('warning', '⚠️ 提交按钮不可用，可能输入内容为空');
        throw new Error('提交按钮不可用，可能输入内容为空');
      }

      this.sendDebugLog('success', '✅ 提交按钮定位成功');
      submitButton.click();
      this.sendDebugLog('success', '✅ 已点击提交按钮');
      console.log('[Gemini Adapter] 任务已提交:', this.task.id);

      // 开始监控回复完成
      this.startMonitoring();

      return true;

    } catch (error) {
      console.error('[Gemini Adapter] 提交任务失败:', error);
      return false;
    }
  }

  // 存储监控相关变量
  private lastResponseLength = 0;
  private stableCheckCount = 0;
  private monitoringInterval: number | null = null;
  private mutationObserver: MutationObserver | null = null;
  private lastMutationTime = 0;
  private completionCheckTimer: number | null = null;

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

  /**
   * 检查任务状态
   * AIDEV-NOTE: 使用停止按钮状态作为主要检测方法
   */
  async checkStatus(): Promise<TaskStatus> {
    try {
      // AIDEV-NOTE: 最可靠的检测方法 - 检查停止按钮状态
      // 生成中：按钮有 'stop' class，显示"停止回答"
      // 完成后：按钮切换回发送状态，没有 'stop' class

      const stopButton = document.querySelector(GeminiAdapter.SELECTORS.stopButton);

      if (stopButton) {
        // 检测到停止按钮 = 正在生成中
        const ariaLabel = stopButton.getAttribute('aria-label');
        this.sendDebugLog('info', `⏳ 检测到停止按钮 (${ariaLabel})，AI 正在生成...`);
        this.stableCheckCount = 0; // 重置计数器
        return TaskStatus.RUNNING;
      }

      // 没有停止按钮了 = 生成完成
      // 再检查一下是否有发送按钮（确保按钮存在）
      const submitButton = document.querySelector(GeminiAdapter.SELECTORS.submitButton);
      if (submitButton) {
        const ariaLabel = submitButton.getAttribute('aria-label');
        this.sendDebugLog('success', `✅ 停止按钮消失，检测到发送按钮 (${ariaLabel})，生成完成！`);
        this.stopMonitoring();
        return TaskStatus.COMPLETED;
      }

      // 备用检测：检查加载指示器
      const loadingIndicator = document.querySelector(GeminiAdapter.SELECTORS.loadingIndicator);
      if (loadingIndicator) {
        const display = window.getComputedStyle(loadingIndicator).display;
        if (display !== 'none') {
          this.sendDebugLog('info', '⏳ 检测到加载指示器...');
          return TaskStatus.RUNNING;
        }
      }

      // 备用检测：文本稳定性
      const latestResponse = document.querySelector(GeminiAdapter.SELECTORS.latestResponse);
      if (!latestResponse) {
        this.sendDebugLog('info', '⏳ 等待响应出现...');
        return TaskStatus.RUNNING;
      }

      const currentLength = latestResponse.textContent?.trim().length || 0;

      if (currentLength === this.lastResponseLength && currentLength > 0) {
        this.stableCheckCount++;
        this.sendDebugLog('info', `⏳ 响应稳定检测: ${this.stableCheckCount}/3 (长度: ${currentLength})`);

        if (this.stableCheckCount >= 3) {
          this.sendDebugLog('success', `✅ 响应稳定 3 次，判定完成 (最终长度: ${currentLength})`);
          this.stopMonitoring();
          return TaskStatus.COMPLETED;
        }
      } else {
        if (this.lastResponseLength > 0) {
          this.sendDebugLog('info', `⏳ 响应长度变化: ${this.lastResponseLength} → ${currentLength}`);
        }
        this.stableCheckCount = 0;
      }

      this.lastResponseLength = currentLength;

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
    this.lastMutationTime = Date.now();

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
   */
  private async checkCompletionAfterStable(): Promise<void> {
    const timeSinceLastMutation = Date.now() - this.lastMutationTime;

    // 如果距离最后一次变化已经超过 3 秒，认为可能已完成
    if (timeSinceLastMutation >= 3000) {
      this.sendDebugLog('info', '✅ DOM 已稳定 3 秒，检查完成状态...');

      // 检查提交按钮状态
      const submitButton = document.querySelector(GeminiAdapter.SELECTORS.submitButton) as HTMLButtonElement;
      if (submitButton) {
        const isDisabled = submitButton.disabled || submitButton.getAttribute('aria-disabled') === 'true';

        if (!isDisabled) {
          // 按钮可用 = 生成完成
          this.sendDebugLog('success', '🎉 提交按钮已激活，确认生成完成！');
          this.stopMonitoring();

          // 通知 background 任务完成
          chrome.runtime.sendMessage({
            type: 'TASK_STATUS_UPDATE',
            taskId: this.task.id,
            status: TaskStatus.COMPLETED
          });
          return;
        }
      }

      // 检查是否还有加载指示器
      const loadingIndicator = document.querySelector(GeminiAdapter.SELECTORS.loadingIndicator);
      if (!loadingIndicator || window.getComputedStyle(loadingIndicator).display === 'none') {
        this.sendDebugLog('success', '🎉 无加载指示器，确认生成完成！');
        this.stopMonitoring();

        chrome.runtime.sendMessage({
          type: 'TASK_STATUS_UPDATE',
          taskId: this.task.id,
          status: TaskStatus.COMPLETED
        });
      } else {
        this.sendDebugLog('info', '⏳ 仍在生成中，继续等待...');
      }
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

    console.log('[Gemini Adapter] 停止监控');
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
   * 清理
   */
  async cleanup(): Promise<void> {
    this.stopMonitoring();
    this.lastResponseLength = 0;
    this.stableCheckCount = 0;
    this.lastMutationTime = 0;
    console.log('[Gemini Adapter] 清理完成');
  }

  /**
   * 辅助方法：延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
