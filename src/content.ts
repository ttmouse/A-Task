// [IN]: DOM, chrome.runtime messages, AdapterFactory
// [OUT]: Page Interaction, Status Updates
// [POS]: Browser Context / Script Injection Agent
// Protocol: When updated, sync this header + src/.folder.md

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
  // OIIOII 域名检测
  if (location.hostname.includes('oiioii.ai') || location.hostname.includes('hogiai')) {
    return SiteType.OIIOII;
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
// let currentStepIndex: number = 0; // Removed duplicate
let monitoringTimer: number | null = null;
let lastMonitoringTick: number = 0;
let watchdogInterval: number | null = null;

// --- Utility Functions ---
function sendDebugLog(level: 'info' | 'success' | 'warning' | 'error', message: string) {
  try {
    chrome.runtime.sendMessage({ type: 'DEBUG_LOG', level, message });
  } catch (e) {
    console.error('[A-Task] Failed to send debug log:', e);
  }
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
    if (monitoringTimer) {
      clearTimeout(monitoringTimer);
      monitoringTimer = null;
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
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  if (monitoringTimer) {
    clearTimeout(monitoringTimer);
    monitoringTimer = null;
  }
}

/**
 * AIDEV-NOTE: Handle step completion for multi-step tasks
 * If more steps exist, submit the next step directly without round-tripping through background
 */
/**
 * AIDEV-NOTE: Execute the next step in the multi-step task
 * This function is called BY the monitoring loop when the previous step is complete.
 * It returns true if the next step was submitted successfully, false otherwise.
 */
async function executeNextStep(taskId: string): Promise<boolean> {
  if (!currentTask || !currentAdapter || !currentSiteType) {
    sendDebugLog('error', '❌ 步骤完成但状态丢失');
    return false;
  }

  // Notify background of step completion (for UI update)
  chrome.runtime.sendMessage({
    type: 'STEP_PROGRESS',
    taskId,
    stepIndex: currentStepIndex,
    totalSteps: getTotalSteps(),
    status: 'completed'
  });

  if (!hasMoreSteps()) {
    // Should not be called if no more steps, but handle gracefully
    return true; // "Success" in the sense that we are done
  }

  // Move to next step
  currentStepIndex++;
  sendDebugLog('success', `🎉 步骤 ${currentStepIndex}/${getTotalSteps()} 完成，准备执行下一步...`);

  // Wait a bit for the page to settle
  await new Promise(resolve => setTimeout(resolve, 2000));

  try {
    // Clean up adapter state for next step
    await currentAdapter.cleanup();

    // Update task's currentStepIndex for the adapter
    currentTask.currentStepIndex = currentStepIndex;

    // Re-create adapter with updated task
    currentAdapter = AdapterFactory.create(currentSiteType, currentTask);

    // Race against a timeout to prevent hanging
    const submitPromise = currentAdapter.submitTask();
    const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
      setTimeout(() => resolve({ timeout: true }), 30000)
    );

    const result = await Promise.race([submitPromise, timeoutPromise]);

    if ((result as any).timeout) {
      sendDebugLog('error', `❌ 步骤 ${currentStepIndex + 1} 提交超时 (30s)`);
      return false;
    }

    const success = result as boolean;
    if (!success) {
      sendDebugLog('error', `❌ 步骤 ${currentStepIndex + 1} 提交失败`);
      chrome.runtime.sendMessage({
        type: 'TASK_STATUS_UPDATE',
        taskId,
        status: TaskStatus.FAILED
      });
      return false;
    }

    sendDebugLog('success', `✅ 步骤 ${currentStepIndex + 1}/${getTotalSteps()} 已提交`);
    return true;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '执行下一步失败';
    sendDebugLog('error', `❌ ${errorMsg}`);
    chrome.runtime.sendMessage({
      type: 'TASK_STATUS_UPDATE',
      taskId,
      status: TaskStatus.FAILED
    });
    return false;
  }
}

function scheduleStatusCheck(taskId: string, delay: number = 2000) {
  console.log(`[A-Task] scheduleStatusCheck called with delay=${delay}ms`);
  sendDebugLog('info', `⏱️ 安排下次状态检查 (${delay}ms 后)`); // DEBUG TRACE

  if (monitoringTimer) {
    clearTimeout(monitoringTimer);
  }

  if (!currentAdapter) {
    sendDebugLog('warning', '⚠️ 监控循环结束 (无 active adapter)');
    return;
  }

  monitoringTimer = window.setTimeout(async () => {
    try {
      if (!currentAdapter) return;
      lastMonitoringTick = Date.now(); // Watchdog Heartbeat

      console.log('[A-Task] Monitoring Tick (Recursive)...');
      const status = await currentAdapter.checkStatus();

      if (status === TaskStatus.COMPLETED) {
        if (isMultiStepTask() && hasMoreSteps()) {
          // MULTI-STEP TRANSITION
          sendDebugLog('info', '🔄 当前步骤完成，准备执行下一步...');
          const success = await executeNextStep(taskId);
          if (success) {
            // Continue loop for next step
            console.log('[A-Task] executeNextStep returned true, scheduling next check...');
            sendDebugLog('info', '✅ 步骤提交成功，继续监控...');
            scheduleStatusCheck(taskId, 2000);
          } else {
            // Failed to execute next step, executeNextStep already logged error
            cleanupTaskState();
          }
        } else {
          // ALL DONE
          sendDebugLog('success', `🎉 任务完成！`);
          chrome.runtime.sendMessage({
            type: 'TASK_STATUS_UPDATE',
            taskId,
            status: TaskStatus.COMPLETED
          });
          cleanupTaskState();
        }
      } else if (status === TaskStatus.FAILED) {
        // FAILED
        sendDebugLog('error', `❌ 任务失败`);
        chrome.runtime.sendMessage({
          type: 'TASK_STATUS_UPDATE',
          taskId,
          status: TaskStatus.FAILED
        });
        cleanupTaskState();
      } else {
        // RUNNING - Continue loop
        scheduleStatusCheck(taskId, 2000);
      }
    } catch (e) {
      console.error('[A-Task] Monitoring loop error:', e);
      sendDebugLog('error', `❌ 监控循环异常: ${e}`);
      // Retry once or stop? Retry for robustness
      scheduleStatusCheck(taskId, 5000);
    }
  }, delay);
}

function startStatusMonitoring(taskId: string) {
  sendDebugLog('info', `🚀 启动递归监控循环`);
  lastMonitoringTick = Date.now();
  scheduleStatusCheck(taskId, 1000);

  // Start Watchdog
  if (watchdogInterval) clearInterval(watchdogInterval);
  watchdogInterval = window.setInterval(() => {
    const timeSinceLastTick = Date.now() - lastMonitoringTick;
    console.log(`[A-Task] Watchdog tick. timeSinceLastTick=${timeSinceLastTick}ms, adapter=${!!currentAdapter}`);

    if (!currentAdapter) {
      console.log('[A-Task] Watchdog stopping: no adapter');
      clearInterval(watchdogInterval!);
      watchdogInterval = null;
      return;
    }
    if (timeSinceLastTick > 8000) {
      sendDebugLog('warning', '🐕 看门狗检测到监控停滞，正在重启监控...');
      console.warn('[A-Task] Watchdog detected stall. Restarting loop.');
      lastMonitoringTick = Date.now();
      scheduleStatusCheck(taskId, 1000);
    }
  }, 4000);
}

sendDebugLog('info', '✅ A-Task content script is ready and listening.');
