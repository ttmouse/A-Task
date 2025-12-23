// AIDEV-NOTE: Gemini 内容脚本 - 注入到 gemini.google.com 页面
// 负责接收任务、执行任务、监控状态

import { GeminiAdapter } from './adapters/gemini-adapter.js';
import { Task, TaskStatus } from './types/task.js';

console.log('[A-Task] Gemini 内容脚本已加载');

// 发送调试日志到侧边栏
function sendDebugLog(level: 'info' | 'success' | 'warning' | 'error', message: string) {
  chrome.runtime.sendMessage({
    type: 'DEBUG_LOG',
    level,
    message
  });
}

sendDebugLog('info', '✅ Content Script 已注入到 Gemini 页面');

// 当前正在执行的适配器实例
let currentAdapter: GeminiAdapter | null = null;
let statusCheckInterval: number | null = null;

const DOM_STATUS_SELECTORS = {
  stopButton: 'button.send-button.stop',
  submitButton: 'button.send-button',
  submitButtonContainer: '.send-button-container',
  loadingIndicator: '.spinner, [aria-label*="正在生成"], [aria-busy="true"]',
  latestResponse: 'message-content:last-child, .model-response:last-child, [data-testid="output-card"]:last-of-type',
  inputBox: 'rich-textarea .ql-editor[contenteditable="true"]'
};

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Content-Gemini] 收到消息:', message);

  if (message.type === 'PING') {
    // PING/PONG 机制 - 确认 content script 已就绪
    sendResponse({ pong: true });
    return;
  }

  if (message.type === 'SUBMIT_TASK') {
    handleSubmitTask(message.task).then(sendResponse);
    return true; // 异步响应
  }

  if (message.type === 'CHECK_STATUS') {
    handleCheckStatus().then(sendResponse);
    return true;
  }

  if (message.type === 'STOP_TASK') {
    handleStopTask().then(sendResponse);
    return true;
  }
});

/**
 * 处理提交任务
 */
async function handleSubmitTask(task: Task): Promise<{ success: boolean; error?: string }> {
  try {
    sendDebugLog('info', `🚀 开始执行任务: ${task.prompt.substring(0, 30)}...`);

    // 创建适配器实例
    currentAdapter = new GeminiAdapter(task);
    sendDebugLog('info', '✅ 适配器创建成功');

    // 提交任务
    sendDebugLog('info', '🔍 正在定位输入框和提交按钮...');
    const success = await currentAdapter.submitTask();

    if (!success) {
      sendDebugLog('error', '❌ 提交任务失败 - 未能找到页面元素');
      return { success: false, error: '提交任务失败' };
    }

    sendDebugLog('success', '✅ 任务已成功提交到 Gemini');
    sendDebugLog('info', '⏳ 开始监控响应状态...');

    // 开始监控状态
    startStatusMonitoring(task.id);

    return { success: true };

  } catch (error) {
    console.error('[Content-Gemini] 提交任务异常:', error);
    const errorMsg = error instanceof Error ? error.message : '未知错误';
    sendDebugLog('error', `❌ 提交任务异常: ${errorMsg}`);
    return {
      success: false,
      error: errorMsg
    };
  }
}

/**
 * 处理检查状态
 */
async function handleCheckStatus(): Promise<{ status: TaskStatus; reason?: string }> {
  if (!currentAdapter) {
    return detectPageStatusFromDom();
  }

  const status = await currentAdapter.checkStatus();
  let reason: string | undefined;

  switch (status) {
    case TaskStatus.RUNNING:
      reason = '任务执行中，等待 Gemini 完成回应';
      break;
    case TaskStatus.COMPLETED:
      reason = '任务已完成，等待下一步';
      break;
    case TaskStatus.FAILED:
      reason = '任务执行失败，请查看调试日志';
      break;
    case TaskStatus.PENDING:
      reason = '任务尚未开始';
      break;
  }

  return { status, reason };
}

/**
 * 处理停止任务
 */
async function handleStopTask(): Promise<{ success: boolean }> {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
    statusCheckInterval = null;
  }

  if (currentAdapter) {
    await currentAdapter.cleanup();
    currentAdapter = null;
  }

  return { success: true };
}

/**
 * 开始状态监控
 */
function startStatusMonitoring(taskId: string) {
  let checkCount = 0;

  // 每2秒检查一次状态
  statusCheckInterval = window.setInterval(async () => {
    if (!currentAdapter) {
      return;
    }

    checkCount++;
    const status = await currentAdapter.checkStatus();

    // 根据状态发送不同的调试日志
    if (status === TaskStatus.RUNNING) {
      if (checkCount % 3 === 0) {
        // 每6秒报告一次进度
        sendDebugLog('info', `⏳ 正在生成中... (已检查 ${checkCount} 次)`);
      }
    }

    // 通知 background 状态变化
    chrome.runtime.sendMessage({
      type: 'TASK_STATUS_UPDATE',
      taskId,
      status
    });

    // 如果任务完成或失败，停止监控
    if (status === TaskStatus.COMPLETED) {
      sendDebugLog('success', '🎉 任务完成！响应已稳定');
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
      }
    } else if (status === TaskStatus.FAILED) {
      sendDebugLog('error', '❌ 任务失败');
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
      }
    }
  }, 2000);
}

/**
 * 在没有适配器执行任务时，通过 DOM 快速检测页面状态
 */
function detectPageStatusFromDom(): { status: TaskStatus; reason: string } {
  const stopButton = document.querySelector(DOM_STATUS_SELECTORS.stopButton);
  if (stopButton) {
    return {
      status: TaskStatus.RUNNING,
      reason: '检测到“停止回答”按钮，页面正在生成响应'
    };
  }

  const loadingIndicator = document.querySelector(DOM_STATUS_SELECTORS.loadingIndicator);
  if (loadingIndicator) {
    const display = window.getComputedStyle(loadingIndicator).display;
    if (display !== 'none') {
      return {
        status: TaskStatus.RUNNING,
        reason: '检测到加载指示器，页面仍在生成'
      };
    }
  }

  const submitButton = document.querySelector(DOM_STATUS_SELECTORS.submitButton) as HTMLButtonElement | null;
  const inputBox = document.querySelector(DOM_STATUS_SELECTORS.inputBox) as HTMLElement | null;
  const inputText = inputBox?.textContent?.replace(/\u200b/g, '').trim() || '';
  const hasInputContent = inputText.length > 0;

  const submitButtonContainer = document.querySelector(
    DOM_STATUS_SELECTORS.submitButtonContainer
  ) as HTMLElement | null;
  const containerDisabled = submitButtonContainer?.classList.contains('disabled') ?? false;

  if (submitButton || submitButtonContainer) {
    const isDisabled = submitButton?.disabled ||
      submitButton?.getAttribute('aria-disabled') === 'true' ||
      containerDisabled;
    const ariaLabel = submitButton?.getAttribute('aria-label') || '';
    const classList = submitButton?.classList;

    const isStopMode =
      (!!classList && (classList.contains('stop') || classList.contains('is-generating'))) ||
      ariaLabel.includes('停止') ||
      ariaLabel.includes('Stop');

    if (isStopMode) {
      return {
        status: TaskStatus.RUNNING,
        reason: '检测到“停止回答”按钮，页面正在生成响应'
      };
    }

    if (!isDisabled) {
      return {
        status: TaskStatus.COMPLETED,
        reason: '发送按钮可用，页面空闲等待输入'
      };
    }

    // 按钮被禁用但没有输入内容 => 正在等待用户输入
    if (!hasInputContent) {
      return {
        status: TaskStatus.PENDING,
        reason: '等待输入提示内容'
      };
    }
  }

  const latestResponse = document.querySelector(DOM_STATUS_SELECTORS.latestResponse) as HTMLElement | null;
  if (latestResponse) {
    const ariaBusy = latestResponse.getAttribute('aria-busy');
    if (ariaBusy === 'true') {
      return {
        status: TaskStatus.RUNNING,
        reason: '最新响应仍在更新'
      };
    }

    const textLength = latestResponse.textContent?.trim().length || 0;
    if (textLength > 0) {
      return {
        status: TaskStatus.COMPLETED,
        reason: '检测到最近一次响应已完成'
      };
    }
  }

  return {
    status: TaskStatus.COMPLETED,
    reason: hasInputContent
      ? '检测到输入内容但未在生成，页面等待发送'
      : '未检测到生成迹象，页面处于等待状态'
  };
}
