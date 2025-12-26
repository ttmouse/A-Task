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
let currentTask: Task | null = null;
let currentSiteType: SiteType | null = null;
let currentStepIndex: number = 0;
let statusCheckInterval: number | null = null;

// --- Utility Functions ---
function sendDebugLog(level: 'info' | 'success' | 'warning' | 'error', message: string) {
  chrome.runtime.sendMessage({ type: 'DEBUG_LOG', level, message });
}

function isMultiStepTask(): boolean {
  return !!(currentTask?.steps && currentTask.steps.length > 1);
}

function hasMoreSteps(): boolean {
  if (!currentTask?.steps) return false;
  return currentStepIndex < currentTask.steps.length - 1;
}

function getTotalSteps(): number {
  return currentTask?.steps?.length || 1;
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
    // AIDEV-NOTE: Store task info for multi-step handling
    currentTask = task;
    currentSiteType = siteType;
    currentStepIndex = task.currentStepIndex || 0;

    const stepInfo = isMultiStepTask()
      ? ` (步骤 ${currentStepIndex + 1}/${getTotalSteps()})`
      : '';
    sendDebugLog('info', `🚀 Executing task${stepInfo}: ${task.prompt.substring(0, 30)}...`);

    // Use the factory with the siteType passed from the background script
    currentAdapter = AdapterFactory.create(siteType, task);
    sendDebugLog('success', `✅ ${siteType} adapter created successfully.`);

    const success = await currentAdapter.submitTask();

    if (!success) {
      sendDebugLog('error', `❌ Submission via adapter failed.`);
      cleanupTaskState();
      return { success: false, error: 'Task submission failed on page.' };
    }

    sendDebugLog('success', '✅ Task submitted successfully. Monitoring status...');
    startStatusMonitoring(task.id);
    return { success: true };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error during task submission.';
    console.error(`[A-Task] Error submitting task:`, error);
    sendDebugLog('error', `❌ ${errorMsg}`);
    cleanupTaskState();
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
    cleanupTaskState();
    sendDebugLog('success', '✅ 任务已停止');
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '停止任务失败';
    console.error('[A-Task] 停止任务异常:', error);
    sendDebugLog('error', `❌ 停止任务失败: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Clean up all task-related state
 */
function cleanupTaskState() {
  currentAdapter = null;
  currentTask = null;
  currentSiteType = null;
  currentStepIndex = 0;
}

/**
 * AIDEV-NOTE: Handle step completion for multi-step tasks
 * If more steps exist, submit the next step directly without round-tripping through background
 */
async function handleStepComplete(taskId: string): Promise<void> {
  if (!currentTask || !currentAdapter || !currentSiteType) {
    sendDebugLog('error', '❌ 步骤完成但状态丢失');
    return;
  }

  // Notify background of step completion (for UI update)
  chrome.runtime.sendMessage({
    type: 'STEP_PROGRESS',
    taskId,
    stepIndex: currentStepIndex,
    totalSteps: getTotalSteps(),
    status: 'completed'
  });

  if (hasMoreSteps()) {
    // Move to next step
    currentStepIndex++;
    sendDebugLog('success', `🎉 步骤 ${currentStepIndex}/${getTotalSteps()} 完成，准备执行下一步...`);

    // Wait a bit for the page to settle
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Clean up adapter state for next step
    await currentAdapter.cleanup();

    // Update task's currentStepIndex for the adapter
    currentTask.currentStepIndex = currentStepIndex;

    // Re-create adapter with updated task (pointing to next step)
    try {
      currentAdapter = AdapterFactory.create(currentSiteType, currentTask);

      const success = await currentAdapter.submitTask();
      if (!success) {
        sendDebugLog('error', `❌ 步骤 ${currentStepIndex + 1} 提交失败`);
        chrome.runtime.sendMessage({
          type: 'TASK_STATUS_UPDATE',
          taskId,
          status: TaskStatus.FAILED
        });
        cleanupTaskState();
        return;
      }

      sendDebugLog('success', `✅ 步骤 ${currentStepIndex + 1}/${getTotalSteps()} 已提交`);
      // Continue monitoring - don't restart interval, it's still running
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '执行下一步失败';
      sendDebugLog('error', `❌ ${errorMsg}`);
      chrome.runtime.sendMessage({
        type: 'TASK_STATUS_UPDATE',
        taskId,
        status: TaskStatus.FAILED
      });
      cleanupTaskState();
    }
  } else {
    // All steps completed
    sendDebugLog('success', `🎉 任务完成！共 ${getTotalSteps()} 个步骤全部执行完毕`);

    // Notify background of final completion
    chrome.runtime.sendMessage({
      type: 'TASK_STATUS_UPDATE',
      taskId,
      status: TaskStatus.COMPLETED
    });

    if (statusCheckInterval) {
      clearInterval(statusCheckInterval);
      statusCheckInterval = null;
    }
    cleanupTaskState();
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

    if (status === TaskStatus.COMPLETED) {
      // AIDEV-NOTE: Don't release adapter immediately!
      // Check if this is a multi-step task with more steps
      if (isMultiStepTask()) {
        // Handle multi-step: don't notify background yet, handle locally
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        statusCheckInterval = null;
        await handleStepComplete(taskId);
      } else {
        // Single step task - notify and cleanup
        sendDebugLog('success', `🎉 Task completed.`);
        chrome.runtime.sendMessage({
          type: 'TASK_STATUS_UPDATE',
          taskId,
          status
        });
        if (statusCheckInterval) clearInterval(statusCheckInterval);
        statusCheckInterval = null;
        cleanupTaskState();
      }
    } else if (status === TaskStatus.FAILED) {
      sendDebugLog('error', `❌ Task failed.`);
      chrome.runtime.sendMessage({
        type: 'TASK_STATUS_UPDATE',
        taskId,
        status
      });
      if (statusCheckInterval) clearInterval(statusCheckInterval);
      statusCheckInterval = null;
      cleanupTaskState();
    }
    // For RUNNING status, just continue monitoring (don't spam background)
  }, 2000); // Check every 2 seconds
}

sendDebugLog('info', '✅ A-Task content script is ready and listening.');
