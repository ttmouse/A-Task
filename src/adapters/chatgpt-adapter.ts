// INPUT: ./base-adapter.js (BaseAdapter 基类), ../types/task.js (TaskStatus)
// OUTPUT: ChatGPTAdapter 类，实现 ChatGPT 网站的任务提交、状态检查、结果获取
// POS: 具体适配器实现，被 AdapterFactory 创建，在 ChatGPT 页面的 content script 中使用
// 一旦本文件被修改，请更新此注释并同步更新 /src/adapters/README.md

import { BaseAdapter } from './base-adapter.js';
import { TaskStatus } from '../types/task.js';

// AIDEV-NOTE: ChatGPT 适配器实现（模板）
// TODO: 需要根据实际 ChatGPT 页面结构调整选择器

export class ChatGPTAdapter extends BaseAdapter {
  // AIDEV-NOTE: 根据实际 ChatGPT 页面结构确定的选择器
  // TODO: 需要检查实际页面并更新这些选择器
  private static readonly SELECTORS = {
    // 输入框选择器 - ChatGPT 使用 textarea
    inputBox: '#prompt-textarea, textarea[data-id="root"]',
    // 提交按钮选择器
    submitButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
    // 停止生成按钮
    stopButton: 'button[data-testid="stop-button"], button[aria-label*="Stop"]',
    // 消息容器
    messagesContainer: '[data-testid="conversation-turn"], .conversation-content',
    // 最新响应
    latestResponse: '[data-testid="conversation-turn"]:last-child [data-message-author-role="assistant"]',
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
      const inputBox = document.querySelector(ChatGPTAdapter.SELECTORS.inputBox) as HTMLTextAreaElement;
      if (!inputBox) {
        this.sendDebugLog('error', '❌ 找不到输入框，请检查选择器');
        throw new Error('找不到 ChatGPT 输入框');
      }
      this.sendDebugLog('success', '✅ 输入框定位成功');

      // 清空并输入内容
      inputBox.value = '';
      inputBox.value = content;

      // 触发输入事件
      inputBox.dispatchEvent(new Event('input', { bubbles: true }));
      inputBox.dispatchEvent(new Event('change', { bubbles: true }));
      this.sendDebugLog('success', `✅ 内容已输入 (${content.length} 字符)`);

      // 等待让输入生效
      await this.sleep(500);

      // 查找并点击提交按钮
      this.sendDebugLog('info', '🔍 正在查找提交按钮...');
      const submitButton = document.querySelector(ChatGPTAdapter.SELECTORS.submitButton) as HTMLButtonElement;
      if (!submitButton) {
        this.sendDebugLog('error', '❌ 找不到提交按钮，请检查选择器');
        throw new Error('找不到 ChatGPT 提交按钮');
      }

      // 检查按钮是否可用
      if (submitButton.disabled) {
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

  /**
   * 检查任务状态
   * AIDEV-NOTE: ChatGPT 通过检测停止按钮来判断是否在生成中
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

      // 检查是否有停止按钮（生成中）
      const stopButton = document.querySelector(ChatGPTAdapter.SELECTORS.stopButton);
      if (stopButton) {
        this.sendDebugLog('info', '⏳ 检测到停止按钮，正在生成...');
        this.stableCheckCount = 0;
        return TaskStatus.RUNNING;
      }

      // 没有停止按钮，检查提交按钮是否可用
      const submitButton = document.querySelector(ChatGPTAdapter.SELECTORS.submitButton) as HTMLButtonElement;
      if (submitButton && !submitButton.disabled) {
        this.sendDebugLog('success', '✅ 提交按钮已激活，生成完成');
        this.stopMonitoring();
        return TaskStatus.COMPLETED;
      }

      // 备用检测：检查加载指示器
      const loadingIndicator = document.querySelector(ChatGPTAdapter.SELECTORS.loadingIndicator);
      if (loadingIndicator) {
        const display = window.getComputedStyle(loadingIndicator).display;
        if (display !== 'none') {
          this.sendDebugLog('info', '⏳ 检测到加载指示器...');
          return TaskStatus.RUNNING;
        }
      }

      // 文本稳定性检测
      const latestResponse = document.querySelector(ChatGPTAdapter.SELECTORS.latestResponse);
      if (!latestResponse) {
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

    const messagesContainer = document.querySelector(ChatGPTAdapter.SELECTORS.messagesContainer);
    if (!messagesContainer) {
      this.sendDebugLog('warning', '⚠️ 找不到消息容器');
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

    // 清空输入框
    try {
      const inputBox = document.querySelector(ChatGPTAdapter.SELECTORS.inputBox) as HTMLTextAreaElement;
      if (inputBox) {
        inputBox.value = '';
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
}
