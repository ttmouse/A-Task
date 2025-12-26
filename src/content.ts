import { AdapterFactory } from './adapters/adapter-factory.js';
import { BaseAdapter } from './adapters/base-adapter.js';
import { Task, TaskStatus, SiteType } from './types/task.js';

console.log('[A-Task] Generic Content Script loaded.');

// Helper to determine the current site based on hostname
function getCurrentSiteType(): SiteType | undefined {
  if (location.hostname.includes('openai.com') || location.hostname.includes('chatgpt.com')) {
    return SiteType.CHATGPT;
  }
  if (location.hostname.includes('gemini.google.com')) {
    return SiteType.GEMINI;
  }
  return undefined;
}

const currentSite = getCurrentSiteType();
if (currentSite) {
  console.log(`[A-Task] Detected site: ${currentSite}`);
} else {
  console.warn('[A-Task] Content script loaded on an unsupported site.');
}

// --- Global State ---
let currentAdapter: BaseAdapter | null = null;
let statusCheckInterval: number | null = null;

// --- Utility Functions ---
function sendDebugLog(level: 'info' | 'success' | 'warning' | 'error', message: string) {
  chrome.runtime.sendMessage({ type: 'DEBUG_LOG', level, message });
}

// --- Message Handling ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ pong: true, site: currentSite });
    return true;
  }

  if (message.type === 'SUBMIT_TASK') {
    // Background script now determines the siteType
    handleSubmitTask(message.task, message.siteType).then(sendResponse);
    return true; // Indicates an async response.
  }

  if (message.type === 'STOP_TASK') {
    handleStopTask().then(sendResponse);
    return true;
  }
  
  if (message.type === 'CHECK_STATUS') {
    handleCheckStatus().then(sendResponse);
    return true; // Indicates an async response.
  }

  return true;
});


async function handleSubmitTask(task: Task, siteType: SiteType): Promise<{ success: boolean; error?: string }> {
  // Site validation is now done by the background script.
  try {
    sendDebugLog('info', `🚀 Executing task for ${siteType}: ${task.prompt.substring(0, 30)}...`);

    // Use the factory with the siteType passed from the background script
    currentAdapter = AdapterFactory.create(siteType, task);
    sendDebugLog('success', `✅ ${siteType} adapter created successfully.`);

    const success = await currentAdapter.submitTask();

    if (!success) {
      sendDebugLog('error', `❌ Submission via adapter failed.`);
      currentAdapter = null; // Clear adapter on failure
      return { success: false, error: 'Task submission failed on page.' };
    }

    sendDebugLog('success', '✅ Task submitted successfully. Monitoring status...');
    startStatusMonitoring(task.id);
    return { success: true };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error during task submission.';
    console.error(`[A-Task] Error submitting task:`, error);
    sendDebugLog('error', `❌ ${errorMsg}`);
    currentAdapter = null; // Clear adapter on error
    return { success: false, error: errorMsg };
  }
}

async function handleCheckStatus(): Promise<{ status: TaskStatus; reason?: string }> {
  if (currentAdapter) {
    const status = await currentAdapter.checkStatus();
    return { status, reason: '正在监控一个任务的执行' };
  }
  // If no adapter is active, the page is considered ready for a new task.
  return { status: TaskStatus.COMPLETED, reason: '页面空闲，无任务执行' };
}

async function handleStopTask(): Promise<{ success: boolean; error?: string }> {
  try {
    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }

    if (!currentAdapter) {
      sendDebugLog('warning', '⚠️ 收到停止指令，但当前没有活跃任务');
      return { success: true };
    }

    sendDebugLog('info', '⏹ 收到停止指令，尝试终止当前任务...');
    await currentAdapter.stopCurrentTask();
    currentAdapter = null;
    sendDebugLog('success', '✅ 任务已停止');
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '停止任务失败';
    console.error('[A-Task] 停止任务异常:', error);
    sendDebugLog('error', `❌ 停止任务失败: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

function startStatusMonitoring(taskId: string) {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }

  statusCheckInterval = window.setInterval(async () => {
    if (!currentAdapter) {
      if (statusCheckInterval) clearInterval(statusCheckInterval);
      return;
    }

    const status = await currentAdapter.checkStatus();

    // Notify background/sidepanel of the status update
    chrome.runtime.sendMessage({
      type: 'TASK_STATUS_UPDATE',
      taskId,
      status
    });

    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
      sendDebugLog(
        status === TaskStatus.COMPLETED ? 'success' : 'error',
        `🎉 Task ${status}. Stopping monitor.`
      );
      if (statusCheckInterval) clearInterval(statusCheckInterval);
      statusCheckInterval = null;
      currentAdapter = null; // Release the adapter
    }
  }, 2000); // Check every 2 seconds
}

sendDebugLog('info', '✅ A-Task content script is ready and listening.');
