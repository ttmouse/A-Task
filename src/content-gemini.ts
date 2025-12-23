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
    return {
      status: TaskStatus.PENDING,
      reason: '页面空闲，未检测到执行中的任务'
    };
  }

  const status = await currentAdapter.checkStatus();
  return { status };
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
