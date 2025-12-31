// [IN]: chrome.runtime events, TaskStorage, User Actions
// [OUT]: Task Orchestration, Content Script Messaging, State Management
// [POS]: Service Worker / Central Controller
// Protocol: When updated, sync this header + src/.folder.md
// AIDEV-NOTE: Service Worker 是任务调度的核心
// 负责：1. 任务队列管理 2. 任务调度 3. 与 content scripts 通信 4. 状态同步

import { TaskStorage } from './storage/task-storage.js';
import { Task, TaskStatus, SiteType } from './types/task.js';

console.log('[A-Task Background] Service Worker 已启动');

// AIDEV-NOTE: 在任务执行期间，将运行时检测到的网站类型附加到任务上
type ExecutingTask = Task & { siteType: SiteType };
// 当前正在执行的任务
let currentTask: ExecutingTask | null = null;

// 监听扩展安装
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] 扩展已安装');
});

// 监听扩展图标点击 - 打开侧边栏
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] 收到消息:', message);

  switch (message.type) {
    case 'NEW_TASK_ADDED':
      handleNewTaskAdded();
      break;

    case 'START_TASK':
      handleStartTask(message.taskId);
      break;

    case 'STOP_TASK':
      handleStopTask(message.taskId).then(sendResponse);
      return true; // 异步响应

    case 'TASK_STATUS_UPDATE':
      handleTaskStatusUpdate(message.taskId, message.status);
      broadcastPageStatus(message.status, message.taskId, 'task');
      break;

    case 'STEP_PROGRESS':
      // Forward step progress to sidepanel for UI update
      handleStepProgress(message.taskId, message.stepIndex, message.totalSteps);
      break;

    case 'OPEN_EXTENSION_PAGE':
      handleOpenExtensionPage();
      break;

    case 'DEBUG_LOG':
      // 转发调试日志到侧边栏
      forwardDebugLog(message);
      break;

    case 'CHECK_CONTENT_SCRIPT':
      // 检测 content script 是否就绪
      handleCheckContentScript().then(sendResponse);
      return true; // 异步响应

    case 'MANUAL_INJECT':
      // 手动注入 content script
      handleManualInject().then(sendResponse);
      return true; // 异步响应

    case 'REQUEST_PAGE_STATUS':
      handleRequestPageStatus().then(sendResponse);
      return true; // 异步响应

    case 'PING':
      // PING 响应 - content script 确认在线
      sendResponse({ pong: true });
      break;
  }
});

/**
 * 处理新任务添加 - 自动开始执行
 */
async function handleNewTaskAdded() {
  console.log('[Background] 新任务已添加');
  // 尝试自动开始执行（如果当前没有任务在运行）
  await startNextPendingTask();
}

/**
 * 处理打开扩展管理页面
 */
async function handleOpenExtensionPage() {
  try {
    // 获取当前扩展的信息
    const extensionInfo = await chrome.management.getSelf();
    const extensionId = extensionInfo.id;

    // 打开扩展管理页面并定位到当前扩展
    await chrome.tabs.create({
      url: `chrome://extensions/?id=${extensionId}`
    });

    console.log('[Background] 打开扩展管理页面:', extensionId);
  } catch (error) {
    console.error('[Background] 打开扩展管理页面失败:', error);
  }
}

/**
 * 转发调试日志到侧边栏
 */
async function forwardDebugLog(message: any) {
  try {
    // 广播消息到所有扩展页面（包括侧边栏）
    const views = chrome.extension.getViews({ type: 'popup' });
    views.forEach(view => {
      view.postMessage(message, '*');
    });

    // 尝试直接发送到所有标签页的侧边栏
    chrome.runtime.sendMessage(message).catch(() => {
      // 忽略错误，可能侧边栏没打开
    });
  } catch (error) {
    // 忽略转发错误
  }
}

/**
 * 辅助函数：获取当前激活的、且是受支持的网站标签页
 */
async function getActiveSupportedSite(): Promise<{ siteType: SiteType, tabId: number } | null> {
  // AIDEV-NOTE: 使用数组来支持一个网站有多个域名
  const siteUrlPatterns: Record<SiteType, string[]> = {
    [SiteType.GEMINI]: ['https://gemini.google.com/'],
    [SiteType.CHATGPT]: ['https://chat.openai.com/', 'https://chatgpt.com/'],
    [SiteType.OIIOII]: ['https://oiioii.ai/', 'https://www.oiioii.ai/']
  };

  try {
    let [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (activeTab && activeTab.url && activeTab.id) {
      for (const [siteType, urls] of Object.entries(siteUrlPatterns)) {
        for (const url of urls) {
          if (activeTab.url.startsWith(url)) {
            return { siteType: siteType as SiteType, tabId: activeTab.id };
          }
        }
      }
    }
  } catch (error) {
    console.error('[Background] 查询激活标签页失败:', error);
  }
  return null;
}


/**
 * 检测 content script 是否就绪
 */
async function handleCheckContentScript(): Promise<{ connected: boolean; site?: SiteType }> {
  try {
    const activeSite = await getActiveSupportedSite();
    if (!activeSite) {
      return { connected: false };
    }

    // 发送 PING 消息，短超时
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(activeSite.tabId, { type: 'PING' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
      ]);

      if (response && response.pong === true) {
        return { connected: true, site: response.site };
      }
      return { connected: false };
    } catch (error) {
      return { connected: false };
    }
  } catch (error) {
    return { connected: false };
  }
}

/**
 * 手动注入 content script - 作为自动注入失败时的备用方案
 */
async function handleManualInject(): Promise<{ success: boolean; error?: string }> {
  try {
    const activeSite = await getActiveSupportedSite();
    if (!activeSite) {
      return {
        success: false,
        error: '当前激活的标签页不是受支持的 AI 网站。'
      };
    }

    console.log(`[Background] 尝试手动注入 content.js 到 tab: ${activeSite.tabId}`);

    // 以编程方式注入通用 content script
    await chrome.scripting.executeScript({
      target: { tabId: activeSite.tabId },
      files: ['content.js']
    });

    // 等待一小段时间让脚本初始化
    await new Promise(resolve => setTimeout(resolve, 500));

    // 验证注入是否成功
    const check = await handleCheckContentScript();
    if (check.connected) {
      console.log('[Background] 手动注入成功并已连接。');
      return { success: true };
    } else {
      return { success: false, error: '注入后仍无法连接，请尝试刷新页面。' };
    }

  } catch (error) {
    console.error('[Background] 手动注入失败:', error);
    return { success: false, error: error instanceof Error ? error.message : '注入时发生未知错误。' };
  }
}

/**
 * 手动检测页面状态
 */
async function handleRequestPageStatus(): Promise<{
  success: boolean;
  status?: TaskStatus;
  detail?: string;
  error?: string;
}> {
  try {
    const activeSite = await getActiveSupportedSite();

    if (!activeSite) {
      return {
        success: false,
        error: '当前激活的标签页不是受支持的 AI 网站 (ChatGPT, Gemini 或 OIIOII)。'
      };
    }

    const response = await chrome.tabs.sendMessage(activeSite.tabId, {
      type: 'CHECK_STATUS'
    });

    if (response?.status) {
      broadcastPageStatus(
        response.status,
        currentTask?.id || null,
        'manual',
        response.reason
      );
      return {
        success: true,
        status: response.status,
        detail: response.reason
      };
    }

    return {
      success: false,
      error: '无法从当前页面读取状态，它可能尚未就绪。'
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '检测失败';
    console.error('[Background] 请求页面状态失败:', errorMessage);
    return {
      success: false,
      error: `无法连接到内容脚本，请尝试刷新 AI 网站页面。(${errorMessage})`
    };
  }
}

/**
 * 处理开始任务
 */
async function handleStartTask(taskId: string) {
  console.log('[Background] 手动开始任务:', taskId);

  const tasks = await TaskStorage.getAllTasks();
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    console.error('[Background] 任务不存在:', taskId);
    return;
  }

  await executeTask(task);
}

/**
 * 处理停止任务（暂停）
 */
async function handleStopTask(taskId: string): Promise<{ success: boolean; error?: string }> {
  console.log('[Background] 暂停任务:', taskId);

  if (currentTask && currentTask.id === taskId) {
    console.log('[Background] currentTask 匹配，通知 content script 停止');
    try {
      // 使用 currentTask 中缓存的 siteType
      await sendMessageToContentScript(currentTask.siteType, {
        type: 'STOP_TASK'
      });
    } catch (error) {
      console.warn('[Background] 通知 content script 停止失败:', error);
    }
    currentTask = null;
  } else {
    console.warn('[Background] currentTask 不匹配或为空，但仍然更新任务状态');
  }

  // 无论如何，都将任务状态更新为 PENDING
  await TaskStorage.updateTask(taskId, {
    status: TaskStatus.PENDING
  });

  console.log('[Background] 任务已暂停，状态已更新为 PENDING');
  return { success: true };
}


/**
 * 处理任务状态更新
 * AIDEV-NOTE: Simplified - multi-step logic now handled by content.ts
 */
async function handleTaskStatusUpdate(taskId: string, status: TaskStatus) {
  console.log('[Background] 任务状态更新:', taskId, status);

  await TaskStorage.updateTask(taskId, {
    status,
    ...(status === TaskStatus.COMPLETED || status === TaskStatus.FAILED
      ? { completedAt: Date.now() }
      : {})
  });

  if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
    console.log(`[Background] 任务${status === TaskStatus.COMPLETED ? '完成' : '失败'}:`, taskId);
    if (currentTask?.id === taskId) {
      currentTask = null;
    }
    // 主动通知 UI 刷新
    chrome.runtime.sendMessage({ type: 'RELOAD_TASKS' });

    // AIDEV-NOTE: 自动开始队列中的下一个任务
    await startNextPendingTask();
  }
}

/**
 * 检查并开始下一个待处理的任务
 */
async function startNextPendingTask() {
  if (currentTask !== null) {
    console.log('[Background] 当前有任务在执行，不启动新任务');
    return;
  }

  const tasks = await TaskStorage.getAllTasks();
  const pendingTask = tasks.find(t => t.status === TaskStatus.PENDING);

  if (pendingTask) {
    console.log('[Background] 自动开始下一个待处理任务:', pendingTask.id);
    await executeTask(pendingTask);
  } else {
    console.log('[Background] 队列中没有更多待处理的任务');
  }
}

/**
 * 处理步骤进度更新（多步骤任务）
 */
async function handleStepProgress(taskId: string, stepIndex: number, totalSteps: number) {
  console.log(`[Background] 步骤进度: ${stepIndex + 1}/${totalSteps}`);

  // Update step status in storage
  await TaskStorage.updateStepStatus(taskId, stepIndex, TaskStatus.COMPLETED);
  await TaskStorage.updateTask(taskId, { currentStepIndex: stepIndex + 1 });

  // Notify UI to refresh
  chrome.runtime.sendMessage({ type: 'RELOAD_TASKS' });
}

/**
 * 执行任务
 */
async function executeTask(task: Task) {
  console.log('[Background] 准备执行任务:', task.id);

  try {
    const activeSite = await getActiveSupportedSite();

    if (!activeSite) {
      throw new Error(`请先打开并激活一个受支持的 AI 网站页面 (ChatGPT, Gemini 或 OIIOII)。`);
    }

    const { siteType, tabId } = activeSite;
    console.log(`[Background] 检测到激活的网站: ${siteType}, Tab ID: ${tabId}`);

    // 确认目标页面已就绪
    let check = await handleCheckContentScript();
    if (!check.connected) {
      console.log('[Background] Content script 未连接，尝试自动注入...');

      // 尝试自动注入
      const injectResult = await handleManualInject();
      if (injectResult.success) {
        console.log('[Background] 自动注入成功，重新检查连接...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        check = await handleCheckContentScript();
      }

      // 如果仍然未连接，则失败
      if (!check.connected) {
        throw new Error(`无法连接到 ${siteType} 页面。已尝试自动注入但失败，请手动刷新该页面。`);
      }
    }

    // 将运行时检测到的 siteType 附加到任务上，用于本次执行
    const taskWithSite: ExecutingTask = { ...task, siteType };
    currentTask = taskWithSite;

    await TaskStorage.updateTask(task.id, {
      status: TaskStatus.RUNNING,
      startedAt: Date.now()
    });

    // 向 content script 发送带有 siteType 的指令
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'SUBMIT_TASK',
      task: task, // 发送原始的、不含 siteType 的任务对象
      siteType: siteType // 明确告知 content script 当前的网站类型
    });

    if (!response?.success) {
      throw new Error(response?.error || '任务提交到页面时失败。');
    }

    console.log('[Background] 任务已成功提交到激活的页面:', task.id);

  } catch (error) {
    console.error('[Background] 执行任务失败:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';

    await TaskStorage.updateTask(task.id, {
      status: TaskStatus.FAILED,
      error: errorMessage
    });

    if (currentTask && currentTask.id === task.id) {
      currentTask = null;
    }
  }
}

/**
 * 处理任务失败 - 此函数现在似乎是多余的，因为错误处理已移入 executeTask
 */
// async function handleTaskFailure(taskId: string) { ... }


/**
 * 发送消息到 content script（带重试机制）
 */
async function sendMessageToContentScript(siteType: SiteType, message: any, retries = 3): Promise<any> {
  const siteUrlPatterns: Record<SiteType, string[]> = {
    [SiteType.GEMINI]: ['https://gemini.google.com/*'],
    [SiteType.CHATGPT]: ['https://chat.openai.com/*', 'https://chatgpt.com/*'],
    [SiteType.OIIOII]: ['https://oiioii.ai/*', 'https://www.oiioii.ai/*']
  };

  const urlPattern = siteUrlPatterns[siteType];
  if (!urlPattern) {
    throw new Error(`不支持的网站类型: ${siteType}`);
  }

  const tabs = await chrome.tabs.query({ url: urlPattern });

  if (tabs.length === 0 || !tabs[0].id) {
    throw new Error(`目标网站 ${siteType} 标签页未找到`);
  }

  const tabId = tabs[0].id;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const waitTime = attempt === 1 ? 200 : 1000 * attempt;
      await new Promise(resolve => setTimeout(resolve, waitTime));

      console.log(`[Background] 尝试发送消息 (${attempt}/${retries}) 到标签页:`, tabId);
      const response = await chrome.tabs.sendMessage(tabId, message);
      console.log('[Background] 消息发送成功');
      return response;

    } catch (error) {
      console.warn(`[Background] 第 ${attempt} 次发送消息失败:`, error);
      if (attempt === retries) {
        throw new Error(`无法连接到 content script (尝试 ${retries} 次)`);
      }
    }
  }
}

/**
 * 广播页面状态到所有可见页面（例如侧边栏）
 */
function broadcastPageStatus(
  status: TaskStatus,
  taskId: string | null,
  source: 'task' | 'manual',
  detail?: string
): void {
  chrome.runtime.sendMessage({
    type: 'PAGE_STATUS_UPDATE',
    status,
    taskId,
    source,
    detail,
    timestamp: Date.now()
  }, () => {
    // 忽略没有接收方时的错误
    if (chrome.runtime.lastError) {
      // console.debug('[Background] 广播页面状态时无接收方:', chrome.runtime.lastError.message);
    }
  });
}
