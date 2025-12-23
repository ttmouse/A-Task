// AIDEV-NOTE: Service Worker 是任务调度的核心
// 负责：1. 任务队列管理 2. 任务调度 3. 与 content scripts 通信 4. 状态同步

import { TaskStorage } from './storage/task-storage.js';
import { Task, TaskStatus, SiteType } from './types/task.js';

console.log('[A-Task Background] Service Worker 已启动');

// 当前正在执行的任务
let currentTask: Task | null = null;

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
 * 处理新任务添加
 */
async function handleNewTaskAdded() {
  console.log('[Background] 新任务已添加');

  // 如果当前没有执行任务，尝试执行下一个
  if (!currentTask) {
    await executeNextTask();
  }
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
 * 检测 content script 是否就绪
 */
async function handleCheckContentScript(): Promise<{ connected: boolean }> {
  try {
    // 尝试找到 Gemini 标签页
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });

    if (tabs.length === 0 || !tabs[0].id) {
      return { connected: false };
    }

    const tabId = tabs[0].id;

    // 发送 PING 消息，短超时
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tabId, { type: 'PING' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
      ]);

      return { connected: response && (response as any).pong === true };
    } catch (error) {
      return { connected: false };
    }
  } catch (error) {
    return { connected: false };
  }
}

/**
 * 手动注入 content script
 */
async function handleManualInject(): Promise<{ success: boolean; error?: string }> {
  try {
    // 查找 Gemini 标签页
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });

    if (tabs.length === 0 || !tabs[0].id) {
      return {
        success: false,
        error: '未找到 Gemini 页面，请先打开 https://gemini.google.com'
      };
    }

    const tabId = tabs[0].id;

    // 手动注入 content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-gemini.js']
    });

    console.log('[Background] Content script 已手动注入');

    // 等待一下让 content script 初始化
    await new Promise(resolve => setTimeout(resolve, 500));

    // 验证注入是否成功
    const checkResult = await handleCheckContentScript();

    if (checkResult.connected) {
      return { success: true };
    } else {
      return {
        success: false,
        error: '注入后仍无法连接，请刷新页面重试'
      };
    }

  } catch (error) {
    console.error('[Background] 手动注入失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '注入失败'
    };
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
    // 优先使用当前任务的站点，否则默认 Gemini
    const targetSite = currentTask?.siteType || SiteType.GEMINI;

    const response = await sendMessageToContentScript(targetSite, {
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
      error: '无法读取页面状态'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '检测失败'
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
  console.log('[Background] 当前任务:', currentTask);

  try {
    // AIDEV-NOTE: 修复暂停逻辑 - 即使 currentTask 不匹配也要更新任务状态
    // 原因：任务可能已经在后台完成或被其他流程清空了 currentTask
    if (currentTask?.id === taskId) {
      console.log('[Background] currentTask 匹配，通知 content script 停止');

      // 通知 content script 停止
      try {
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

    // AIDEV-NOTE: 无论 currentTask 是否匹配，都要更新任务状态
    // 这样可以避免 UI 显示不一致的问题
    await TaskStorage.updateTask(taskId, {
      status: TaskStatus.PENDING
    });

    console.log('[Background] 任务已暂停，状态已更新为 PENDING');

    // AIDEV-NOTE: 暂停后不自动执行下一个任务
    // 用户需要手动点击"开始"按钮来继续执行任务

    return { success: true };
  } catch (error) {
    console.error('[Background] 暂停任务失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '暂停失败'
    };
  }
}

/**
 * 处理任务状态更新
 */
async function handleTaskStatusUpdate(taskId: string, status: TaskStatus) {
  console.log('[Background] 任务状态更新:', taskId, status);

  // AIDEV-NOTE: 支持多步骤任务
  // 如果任务完成，检查是否有下一步
  if (status === TaskStatus.COMPLETED && currentTask?.id === taskId) {
    console.log('[Background] 步骤完成，检查是否有下一步');

    // 检查任务是否有多步骤
    const tasks = await TaskStorage.getAllTasks();
    const task = tasks.find(t => t.id === taskId);

    if (task?.steps && task.steps.length > 1) {
      // 更新当前步骤状态
      const currentStepIndex = task.currentStepIndex || 0;
      await TaskStorage.updateStepStatus(taskId, currentStepIndex, TaskStatus.COMPLETED);

      // 检查是否有下一步
      const hasNextStep = await TaskStorage.moveToNextStep(taskId);

      if (hasNextStep) {
        console.log('[Background] 开始执行下一步:', currentStepIndex + 1);

        // 等待一小段时间，让 content script 完成清理
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 获取更新后的任务
        const updatedTasks = await TaskStorage.getAllTasks();
        const updatedTask = updatedTasks.find(t => t.id === taskId);

        if (updatedTask) {
          // 继续执行下一步（不需要更新 currentTask，因为还是同一个任务）
          try {
            // 发送任务到 content script
            const response = await sendMessageToContentScript(updatedTask.siteType, {
              type: 'SUBMIT_TASK',
              task: updatedTask
            });

            if (!response?.success) {
              throw new Error(response?.error || '提交下一步失败');
            }

            console.log('[Background] 下一步已提交');
          } catch (error) {
            console.error('[Background] 执行下一步失败:', error);
            await TaskStorage.updateTask(taskId, {
              status: TaskStatus.FAILED,
              error: error instanceof Error ? error.message : '执行下一步失败'
            });
            currentTask = null;
            await handleTaskFailure(taskId);
          }
        }
        return;
      }

      // 所有步骤都完成了
      console.log('[Background] 所有步骤已完成');
    }

    // 更新整个任务为完成状态
    await TaskStorage.updateTask(taskId, {
      status: TaskStatus.COMPLETED,
      completedAt: Date.now()
    });

    console.log('[Background] 任务完成:', taskId);
    currentTask = null;
    await executeNextTask();

  } else if (status === TaskStatus.FAILED) {
    // 更新任务状态
    await TaskStorage.updateTask(taskId, {
      status
    });

    console.log('[Background] 任务失败:', taskId);
    await handleTaskFailure(taskId);

  } else {
    // 其他状态更新
    await TaskStorage.updateTask(taskId, {
      status
    });
  }
}

/**
 * 执行下一个待执行任务
 */
async function executeNextTask() {
  if (currentTask) {
    console.log('[Background] 当前有任务在执行，跳过');
    return;
  }

  const nextTask = await TaskStorage.getNextPendingTask();

  if (!nextTask) {
    console.log('[Background] 没有待执行任务');
    return;
  }

  await executeTask(nextTask);
}

/**
 * 执行任务
 */
async function executeTask(task: Task) {
  console.log('[Background] 开始执行任务:', task.id);

  currentTask = task;

  // 更新任务状态
  await TaskStorage.updateTask(task.id, {
    status: TaskStatus.RUNNING,
    startedAt: Date.now()
  });

  try {
    // 获取目标网站的标签页
    const tab = await getOrCreateSiteTab(task.siteType);

    if (!tab || !tab.id) {
      throw new Error('无法打开目标网站');
    }

    // 等待页面加载完成
    await waitForTabLoad(tab.id);

    // AIDEV-NOTE: 额外等待 2 秒确保 content script 完全注入
    console.log('[Background] 页面已加载，等待 content script 注入...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 发送任务到 content script
    const response = await sendMessageToContentScript(task.siteType, {
      type: 'SUBMIT_TASK',
      task
    });

    if (!response?.success) {
      throw new Error(response?.error || '提交任务失败');
    }

    console.log('[Background] 任务已提交到网站:', task.id);

  } catch (error) {
    console.error('[Background] 执行任务失败:', error);

    await TaskStorage.updateTask(task.id, {
      status: TaskStatus.FAILED,
      error: error instanceof Error ? error.message : '未知错误'
    });

    currentTask = null;
    await handleTaskFailure(task.id);
  }
}

/**
 * 处理任务失败
 */
async function handleTaskFailure(taskId: string) {
  const tasks = await TaskStorage.getAllTasks();
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    return;
  }

  // 检查是否需要重试
  if (task.retryCount < task.maxRetries) {
    console.log(`[Background] 任务将重试 (${task.retryCount + 1}/${task.maxRetries}):`, taskId);

    // 更新重试次数并重置为待执行
    await TaskStorage.updateTask(taskId, {
      status: TaskStatus.PENDING,
      retryCount: task.retryCount + 1
    });

    // 延迟后重试
    setTimeout(() => {
      executeNextTask();
    }, 5000); // 5秒后重试

  } else {
    console.log('[Background] 任务已达最大重试次数:', taskId);
    currentTask = null;
    await executeNextTask();
  }
}

/**
 * 获取或创建网站标签页
 */
async function getOrCreateSiteTab(siteType: SiteType): Promise<chrome.tabs.Tab | null> {
  const siteUrls: Record<SiteType, string> = {
    [SiteType.GEMINI]: 'https://gemini.google.com/app',
    [SiteType.CHATGPT]: 'https://chat.openai.com/'
  };

  const targetUrl = siteUrls[siteType];

  // 查找是否已有该网站的标签页
  const tabs = await chrome.tabs.query({ url: `${targetUrl}*` });

  if (tabs.length > 0 && tabs[0].id) {
    // 激活已有标签页
    await chrome.tabs.update(tabs[0].id, { active: true });
    return tabs[0];
  }

  // 创建新标签页
  return await chrome.tabs.create({ url: targetUrl, active: true });
}

/**
 * 等待标签页加载完成
 */
function waitForTabLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (tab.status === 'complete') {
        resolve();
      } else {
        const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (updatedTabId === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  });
}

/**
 * 发送消息到 content script（带重试机制）
 */
async function sendMessageToContentScript(siteType: SiteType, message: any, retries = 5): Promise<any> {
  const siteUrls: Record<SiteType, string> = {
    [SiteType.GEMINI]: 'https://gemini.google.com/app*',
    [SiteType.CHATGPT]: 'https://chat.openai.com/*'
  };

  const tabs = await chrome.tabs.query({ url: siteUrls[siteType] });

  if (tabs.length === 0 || !tabs[0].id) {
    throw new Error('目标网站标签页未找到');
  }

  const tabId = tabs[0].id;

  // AIDEV-NOTE: 增强的重试机制，更长的等待时间
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // 每次尝试前都等待一下
      const waitTime = attempt === 1 ? 500 : 2000 * attempt;
      console.log(`[Background] 等待 ${waitTime}ms 后发送消息 (${attempt}/${retries})`);
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
      console.debug('[Background] 广播页面状态时无接收方:', chrome.runtime.lastError.message);
    }
  });
}
