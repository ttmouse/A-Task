import { TaskStorage } from '../storage/task-storage.js';
import { Task, TaskStatus, TaskType, SiteType, TaskStep } from '../types/task.js';

// DOM 元素
const panelTitle = document.getElementById('panelTitle') as HTMLHeadingElement;
const guideBtn = document.getElementById('guideBtn') as HTMLButtonElement;
const addTaskBtn = document.getElementById('addTaskBtn') as HTMLButtonElement;
const addTaskModal = document.getElementById('addTaskModal') as HTMLDivElement;
const modalTitle = document.getElementById('modalTitle') as HTMLHeadingElement;
const closeModalBtn = document.getElementById('closeModalBtn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement;
const submitTaskBtn = document.getElementById('submitTaskBtn') as HTMLButtonElement;
const taskList = document.getElementById('taskList') as HTMLDivElement;
const emptyState = document.getElementById('emptyState') as HTMLDivElement;

// 搜索元素
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const clearSearchBtn = document.getElementById('clearSearchBtn') as HTMLButtonElement;
let currentSearchQuery = '';
let allTasks: Task[] = []; // 缓存所有任务以便搜索

// 快捷录入元素
const quickInput = document.getElementById('quickInput') as HTMLTextAreaElement;
const quickSubmitBtn = document.getElementById('quickSubmitBtn') as HTMLButtonElement;

// 连接状态元素
const statusConnectionDot = document.getElementById('statusConnectionDot') as HTMLSpanElement;
const statusConnectionText = document.getElementById('statusConnectionText') as HTMLSpanElement;
const statusConnectionItem = document.getElementById('connectionStatusItem') as HTMLDivElement;
const statusPageDot = document.getElementById('statusPageDot') as HTMLSpanElement;
const statusPageText = document.getElementById('statusPageText') as HTMLSpanElement;
const statusPageItem = document.getElementById('pageStatusItem') as HTMLDivElement;
const manualInjectBtn = document.getElementById('manualInjectBtn') as HTMLButtonElement;
const checkPageStatusBtn = document.getElementById('checkPageStatusBtn') as HTMLButtonElement;
// Store the original icon HTML instead of text content
const manualPageStatusBtnDefaultHtml = checkPageStatusBtn.innerHTML;

// 日志元素
const debugContent = document.getElementById('debugContent') as HTMLDivElement;
const logPanel = document.getElementById('logPanel') as HTMLElement;
const toggleConsoleBtn = document.getElementById('toggleConsoleBtn') as HTMLButtonElement;

// 表单元素
const taskTypeSelect = document.getElementById('taskTypeSelect') as HTMLSelectElement;
const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
const maxRetriesInput = document.getElementById('maxRetriesInput') as HTMLInputElement;
const editingTaskIdInput = document.getElementById('editingTaskId') as HTMLInputElement;

type PageIndicatorState = TaskStatus | 'idle' | 'checking' | 'unknown';
let currentPageStatus: PageIndicatorState = 'idle';
let manualPageStatusAvailable = false;
let manualPageStatusChecking = false;
type InputIndicatorState = 'unknown' | 'idle' | 'ready' | 'waiting' | 'busy' | 'error' | 'blocked';
let currentInputStatus: InputIndicatorState = 'unknown';
let lastPageStatusDetail: string | undefined;
let lastInputStatusDetail: string | undefined;

type IndicatorVisualState = 'ok' | 'busy' | 'warn' | 'error' | 'idle';
const INDICATOR_CLASSES = ['state-ok', 'state-busy', 'state-warn', 'state-error', 'state-idle'];

function applyIndicatorState(dot: HTMLElement, state: IndicatorVisualState) {
  dot.classList.remove(...INDICATOR_CLASSES);
  dot.classList.add(`state-${state}`);
}

function setStatusText(
  textElement: HTMLElement,
  value: string,
  detail?: string,
  container?: HTMLElement
) {
  textElement.textContent = value;
  const target = container || textElement;
  if (detail) {
    target.setAttribute('title', detail);
  } else {
    target.removeAttribute('title');
  }
}

// 事件监听
// 事件监听
panelTitle.addEventListener('click', openExtensionPage);
guideBtn.addEventListener('click', openGuide);
addTaskBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
submitTaskBtn.addEventListener('click', handleSubmitTask);
manualInjectBtn.addEventListener('click', handleManualInject);
checkPageStatusBtn.addEventListener('click', handleManualPageStatusCheck);
toggleConsoleBtn.addEventListener('click', toggleConsole);

// Log Panel
const clearLogsBtn = document.getElementById('clearLogsBtn') as HTMLButtonElement;
if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', clearDebugLogs);
}

// 搜索事件监听
if (searchInput) {
  searchInput.addEventListener('input', handleSearchInput);
}
if (clearSearchBtn) {
  clearSearchBtn.addEventListener('click', handleClearSearch);
}

// 快捷录入事件监听
if (quickInput) {
  quickInput.addEventListener('keydown', handleQuickInputKeydown);
  quickInput.addEventListener('input', handleQuickInputResize);
}
if (quickSubmitBtn) {
  quickSubmitBtn.addEventListener('click', handleQuickSubmit);
}

// 初始化
setManualPageStatusCheckEnabled(false);
manualInjectBtn.disabled = true;
updateInputStatus('unknown', '等待页面状态');
init();

async function init() {
  await loadTasks();
  await initConsoleState(); // 加载并应用控制台显示状态

  // 检测连接状态
  checkConnectionStatus();

  // 定期检测连接状态
  setInterval(checkConnectionStatus, 10000); // 每10秒检测一次

  // 监听存储变化
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      console.log('[Sidepanel] Storage 变化检测到，重新加载任务列表', changes);
      loadTasks();
    }
  });

  // 监听调试消息
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DEBUG_LOG') {
      addDebugLog(message.level, message.message);
    }
    if (message.type === 'CONNECTION_STATUS') {
      updateConnectionStatus(message.status);
    }
    if (message.type === 'PAGE_STATUS_UPDATE') {
      const meta = formatPageStatusDetail({
        source: message.source,
        taskId: message.taskId,
        timestamp: message.timestamp
      });
      const detailText = message.detail
        ? [message.detail, meta].filter(Boolean).join(' · ')
        : meta;
      updatePageStatus(message.status as TaskStatus, detailText);
    }
    if (message.type === 'INPUT_STATUS_UPDATE') {
      updateInputStatus(message.state as InputIndicatorState, message.detail);
    }
    if (message.type === 'RELOAD_TASKS') { // <-- 新增监听器
      console.log('[Sidepanel] Received RELOAD_TASKS command, reloading...');
      loadTasks();
    }
  });
}



function clearDebugLogs() { // <-- 新函数定义
  debugContent.innerHTML = '<div class="log-empty">System ready...</div>';
  debugContent.scrollTop = 0; // 滚动到顶部
}

/**
 * 检测 content script 连接状态
 */
async function checkConnectionStatus() {
  try {
    updateConnectionStatus('checking');

    const response = await chrome.runtime.sendMessage({ type: 'CHECK_CONTENT_SCRIPT' });

    if (response?.connected) {
      updateConnectionStatus('connected');
    } else {
      updateConnectionStatus('disconnected');
    }
  } catch (error) {
    updateConnectionStatus('disconnected');
  }
}

/**
 * 更新页面状态指示器
 */
function updatePageStatus(state: PageIndicatorState, detail?: string) {
  currentPageStatus = state;
  lastPageStatusDetail = detail;
  refreshExecutionIndicator();
}

function formatPageStatusDetail(params: {
  source?: 'task' | 'manual';
  taskId?: string | null;
  timestamp?: number;
  note?: string;
} = {}): string {
  const parts: string[] = [];

  if (params.source === 'manual') {
    parts.push('手动检测');
  } else if (params.source === 'task') {
    parts.push('任务监控');
  }

  if (params.taskId) {
    parts.push(`任务 ${formatTaskId(params.taskId)}`);
  }

  if (params.note) {
    parts.push(params.note);
  }

  if (params.timestamp) {
    parts.push(new Date(params.timestamp).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }));
  }

  return parts.join(' · ') || '等待来自页面的状态';
}

function formatTaskId(taskId: string): string {
  if (taskId.length <= 10) {
    return taskId;
  }
  return `${taskId.slice(0, 4)}...${taskId.slice(-4)}`;
}

function isPageStatusIdleState(): boolean {
  return currentPageStatus === 'idle' || currentPageStatus === 'unknown';
}

function updateInputStatus(state: InputIndicatorState, detail?: string) {
  currentInputStatus = state;
  lastInputStatusDetail = detail;
  refreshExecutionIndicator();
}

// 将页面（任务）状态与输入框状态融合到单一指示器
function refreshExecutionIndicator() {
  const display = computeExecutionIndicator();
  applyIndicatorState(statusPageDot, display.visual);
  setStatusText(statusPageText, display.text, display.detail, statusPageItem);
}

function computeExecutionIndicator(): { text: string; detail: string; visual: IndicatorVisualState } {
  const pageDetail = lastPageStatusDetail;
  const inputDetail = lastInputStatusDetail;

  if (currentPageStatus === 'checking') {
    return {
      text: '检测中',
      detail: pageDetail || '正在与页面通信',
      visual: 'busy'
    };
  }

  if (currentPageStatus === 'unknown') {
    return {
      text: '未知',
      detail: pageDetail || '等待来自页面的状态',
      visual: 'warn'
    };
  }

  if (currentPageStatus === TaskStatus.FAILED) {
    return {
      text: '错误',
      detail: pageDetail || '请查看调试日志',
      visual: 'error'
    };
  }

  if (currentPageStatus === TaskStatus.RUNNING) {
    return {
      text: '生成中',
      detail: pageDetail || inputDetail || 'Gemini 正在生成内容',
      visual: 'busy'
    };
  }

  switch (currentInputStatus) {
    case 'error':
      return {
        text: '错误',
        detail: inputDetail || '无法定位输入框',
        visual: 'error'
      };
    case 'blocked':
      return {
        text: '受阻',
        detail: inputDetail || '页面忙碌，暂不可输入',
        visual: 'warn'
      };
    case 'waiting':
      return {
        text: '等待空闲',
        detail: inputDetail || pageDetail || '页面正在生成，暂不可输入',
        visual: 'busy'
      };
    case 'busy':
      return {
        text: '执行中',
        detail: inputDetail || '任务正在执行',
        visual: 'busy'
      };
    case 'ready':
      return {
        text: '可输入',
        detail: inputDetail || '输入框已就绪',
        visual: 'ok'
      };
    case 'idle':
      return {
        text: '空闲',
        detail: inputDetail || '等待新的任务',
        visual: 'idle'
      };
  }

  if (currentPageStatus === TaskStatus.COMPLETED) {
    return {
      text: '完成',
      detail: pageDetail || '页面已生成完毕',
      visual: 'ok'
    };
  }

  if (currentPageStatus === TaskStatus.PENDING) {
    return {
      text: '待执行',
      detail: pageDetail || '任务尚未开始',
      visual: 'warn'
    };
  }

  if (currentPageStatus === 'idle') {
    return {
      text: '空闲',
      detail: pageDetail || inputDetail || '等待新的任务',
      visual: 'idle'
    };
  }

  return {
    text: '未知',
    detail: pageDetail || inputDetail || '等待来自页面的状态',
    visual: 'warn'
  };
}

function setManualPageStatusCheckEnabled(enabled: boolean) {
  manualPageStatusAvailable = enabled;
  if (!manualPageStatusChecking) {
    checkPageStatusBtn.disabled = !enabled;
  }
}

/**
 * 更新连接状态显示
 */
function updateConnectionStatus(status: 'checking' | 'connected' | 'disconnected') {
  switch (status) {
    case 'checking':
      applyIndicatorState(statusConnectionDot, 'busy');
      setStatusText(statusConnectionText, '检测中', '正在检测 content script', statusConnectionItem);
      manualInjectBtn.disabled = true;
      if (isPageStatusIdleState()) {
        updatePageStatus('checking', '正在检测页面连接状态...');
      }
      setManualPageStatusCheckEnabled(false);
      break;
    case 'connected':
      applyIndicatorState(statusConnectionDot, 'ok');
      setStatusText(statusConnectionText, '已连接', 'Content Script 在线', statusConnectionItem);
      manualInjectBtn.disabled = true;
      if (isPageStatusIdleState()) {
        updatePageStatus('idle', '已连接，等待任务或手动检测');
      }
      setManualPageStatusCheckEnabled(true);
      if (currentInputStatus === 'unknown') {
        updateInputStatus('idle', '等待新的任务');
      }
      break;
    case 'disconnected':
      applyIndicatorState(statusConnectionDot, 'error');
      setStatusText(statusConnectionText, '未连接', '请打开 Gemini 页面', statusConnectionItem);
      manualInjectBtn.disabled = false;
      updatePageStatus('unknown', '未连接，无法检测页面状态');
      setManualPageStatusCheckEnabled(false);
      updateInputStatus('unknown', '未连接，无法检测输入状态');
      break;
  }
}

/**
 * 手动注入 content script
 */
async function handleManualInject() {
  addDebugLog('info', 'Attempting manual injection of Content Script...');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'MANUAL_INJECT' });

    if (response?.success) {
      addDebugLog('success', 'Manual injection successful!');
      // 立即重新检测连接状态
      setTimeout(checkConnectionStatus, 1000);
    } else {
      addDebugLog('error', `Manual injection failed: ${response?.error || 'Unknown error'}`);
    }
  } catch (error) {
    addDebugLog('error', `Manual injection exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 手动检测页面状态
 */
async function handleManualPageStatusCheck() {
  if (manualPageStatusChecking || checkPageStatusBtn.disabled) {
    return;
  }

  manualPageStatusChecking = true;
  checkPageStatusBtn.disabled = true;
  checkPageStatusBtn.textContent = '…';
  updatePageStatus('checking', '正在手动检测页面状态...');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'REQUEST_PAGE_STATUS' });

    if (response?.success && response.status) {
      const meta = formatPageStatusDetail({
        source: 'manual',
        timestamp: Date.now(),
        note: '手动检测'
      });
      const detail = response.detail
        ? [response.detail, meta].join(' · ')
        : meta;
      const status = response.status as TaskStatus;
      updatePageStatus(status, detail);
      if (status === TaskStatus.COMPLETED) {
        updateInputStatus('idle', '手动检测：页面空闲');
      } else if (status === TaskStatus.RUNNING) {
        updateInputStatus('waiting', '手动检测：页面仍在生成');
      }
    } else {
      updatePageStatus('unknown', response?.error || '无法检测页面状态');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '手动检测失败';
    updatePageStatus('unknown', message);
  } finally {
    manualPageStatusChecking = false;
    checkPageStatusBtn.innerHTML = manualPageStatusBtnDefaultHtml;
    checkPageStatusBtn.disabled = !manualPageStatusAvailable;
  }
}

/**
 * 加载任务列表
 */
async function loadTasks() {
  allTasks = await TaskStorage.getAllTasks();
  renderFilteredTasks();
}

/**
 * 根据搜索条件渲染任务列表
 */
function renderFilteredTasks() {
  const query = currentSearchQuery.toLowerCase().trim();
  let filteredTasks = allTasks;

  if (query) {
    filteredTasks = allTasks.filter(task => {
      // 搜索任务内容
      if (task.prompt.toLowerCase().includes(query)) return true;
      // 搜索步骤内容
      if (task.steps) {
        for (const step of task.steps) {
          if (step.content.toLowerCase().includes(query)) return true;
        }
      }
      return false;
    });
  }

  if (filteredTasks.length === 0) {
    if (query) {
      // 搜索无结果
      taskList.innerHTML = `
        <div class="no-results-state">
          <i class="ri-search-line no-results-icon"></i>
          <p>没有找到包含 "${escapeHtml(query)}" 的任务</p>
        </div>
      `;
    } else {
      // 没有任务
      taskList.innerHTML = '';
      taskList.appendChild(emptyState);
    }
    return;
  }

  // 移除空状态
  if (taskList.contains(emptyState)) {
    taskList.removeChild(emptyState);
  }

  // 渲染任务列表
  taskList.innerHTML = filteredTasks.map(task => renderTaskItem(task)).join('');

  // 绑定任务操作事件
  bindTaskActions();
}

/**
 * 处理搜索输入
 */
function handleSearchInput() {
  const query = searchInput.value;
  currentSearchQuery = query;

  // 显示/隐藏清除按钮
  if (clearSearchBtn) {
    clearSearchBtn.style.display = query ? 'flex' : 'none';
  }

  // 实时过滤
  renderFilteredTasks();
}

/**
 * 清除搜索
 */
function handleClearSearch() {
  searchInput.value = '';
  currentSearchQuery = '';
  if (clearSearchBtn) {
    clearSearchBtn.style.display = 'none';
  }
  renderFilteredTasks();
  searchInput.focus();
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 渲染单个任务项
 */
function renderTaskItem(task: Task): string {
  const statusText = {
    [TaskStatus.PENDING]: '待执行',
    [TaskStatus.RUNNING]: '执行中',
    [TaskStatus.COMPLETED]: '已完成',
    [TaskStatus.FAILED]: '失败'
  };

  const taskTypeText = {
    [TaskType.TEXT]: '文本',
    [TaskType.IMAGE]: '图片'
  };

  const createdDate = new Date(task.createdAt).toLocaleString('zh-CN');

  // 多步骤任务显示进度
  let stepInfo = '';
  if (task.steps && task.steps.length > 1) {
    const currentStep = (task.currentStepIndex || 0) + 1;
    stepInfo = `<span>步骤: ${currentStep}/${task.steps.length}</span>`;
  }

  // AIDEV-NOTE: 调试输出 - 显示任务状态和按钮渲染
  console.log('[Sidepanel] 渲染任务:', {
    id: task.id,
    status: task.status,
    isRunning: task.status === TaskStatus.RUNNING,
    willShowStopButton: task.status === TaskStatus.RUNNING
  });

  return `
    <div class="task-item" data-task-id="${task.id}">
      <div class="task-header">
        <span class="task-status ${task.status}">${statusText[task.status]}</span>
        <div class="task-actions">
          ${task.status === TaskStatus.PENDING ? '<button class="start-task" title="开始执行"><i class="ri-play-fill"></i></button>' : ''}
          ${task.status === TaskStatus.RUNNING ? '<button class="stop-task" title="暂停"><i class="ri-pause-fill"></i></button>' : ''}
          ${task.status === TaskStatus.FAILED || task.status === TaskStatus.COMPLETED ? '<button class="retry-task" title="重试"><i class="ri-refresh-line"></i></button>' : ''}
          ${task.status === TaskStatus.PENDING || task.status === TaskStatus.FAILED || task.status === TaskStatus.COMPLETED ? '<button class="edit-task" title="编辑"><i class="ri-edit-line"></i></button>' : ''}
          <button class="delete-task" title="删除"><i class="ri-delete-bin-line"></i></button>
        </div>
      </div>
      
      <!-- Prompt Text (Truncated via CSS) -->
      <div class="task-content" title="${task.prompt}">${task.prompt}</div>

      <!-- Steps Preview -->
      ${renderTaskStepsPreview(task)}

      <div class="task-meta">
        <span>${taskTypeText[task.taskType]}</span>
        <span>${createdDate}</span>
        ${stepInfo}
        ${task.retryCount > 0 ? `<span>重试: ${task.retryCount}/${task.maxRetries}</span>` : ''}
      </div>
      ${task.error ? `<div style="color: #d32f2f; font-size: 12px; margin-top: 8px;">错误: ${task.error}</div>` : ''}
    </div>
  `;
}

function renderTaskStepsPreview(task: Task): string {
  if (!task.steps || task.steps.length === 0) {
    return '';
  }

  const maxStepsToShow = 3;
  const stepsToShow = task.steps.slice(0, maxStepsToShow);
  const remainingSteps = task.steps.length - maxStepsToShow;

  const itemsHtml = stepsToShow.map(step => {
    // Determine icon and style based on step status
    // Note: step.status might update as we fix the backend logic, 
    // but for now we fallback to simple logic if step.status isn't fully reliable or 
    // if we want to infer from task.currentStepIndex

    let icon = '<i class="ri-checkbox-blank-circle-line"></i>';
    let activeClass = '';

    // Check if this step is the current one
    const isCurrent = task.currentStepIndex === step.index;
    const isPast = (task.currentStepIndex || 0) > step.index;

    if (task.status === TaskStatus.COMPLETED) {
      icon = '<i class="ri-checkbox-circle-fill" style="color: var(--accent-teal)"></i>';
    } else if (task.status === TaskStatus.FAILED && isCurrent) {
      icon = '<i class="ri-close-circle-fill" style="color: var(--accent-pink)"></i>';
    } else if (isPast) {
      icon = '<i class="ri-checkbox-circle-fill" style="color: var(--accent-teal)"></i>';
    } else if (isCurrent && task.status === TaskStatus.RUNNING) {
      icon = '<i class="ri-loader-4-line" style="animation: spin 1s linear infinite; color: var(--primary)"></i>';
      activeClass = 'active';
    }

    return `
      <div class="step-preview-item ${activeClass}">
        <div class="step-icon">${icon}</div>
        <div class="step-preview-content">${step.index + 1}. ${step.content}</div>
      </div>
    `;
  }).join('');

  let moreHtml = '';
  if (remainingSteps > 0) {
    moreHtml = `<div class="steps-more">... 还有 ${remainingSteps} 个步骤</div>`;
  }

  return `
    <div class="task-steps-preview">
      ${itemsHtml}
      ${moreHtml}
    </div>
  `;
}

/**
 * 绑定任务操作事件
 */
function bindTaskActions() {
  // 开始任务
  document.querySelectorAll('.start-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId) {
        console.log('[Sidepanel] 点击开始任务:', taskId);
        await startTask(taskId);
      }
    });
  });

  // 停止任务（暂停）
  document.querySelectorAll('.stop-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId) {
        console.log('[Sidepanel] 点击暂停任务:', taskId);
        await stopTask(taskId);
      }
    });
  });

  // 重试任务
  document.querySelectorAll('.retry-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId) {
        console.log('[Sidepanel] 点击重试任务:', taskId);
        await retryTask(taskId);
      }
    });
  });

  // 编辑任务
  document.querySelectorAll('.edit-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId) {
        console.log('[Sidepanel] 点击编辑任务:', taskId);
        await editTask(taskId);
      }
    });
  });

  // 删除任务
  document.querySelectorAll('.delete-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId && confirm('确定要删除这个任务吗？')) {
        console.log('[Sidepanel] 点击删除任务:', taskId);
        await TaskStorage.deleteTask(taskId);
      }
    });
  });

  console.log('[Sidepanel] 事件绑定完成:', {
    startButtons: document.querySelectorAll('.start-task').length,
    stopButtons: document.querySelectorAll('.stop-task').length,
    retryButtons: document.querySelectorAll('.retry-task').length,
    editButtons: document.querySelectorAll('.edit-task').length,
    deleteButtons: document.querySelectorAll('.delete-task').length
  });
}

/**
 * 打开使用指南
 */
function openGuide() {
  // 在新标签页中打开使用指南（简单HTML版本）
  const guideUrl = chrome.runtime.getURL('pages/guide-simple.html');
  chrome.tabs.create({ url: guideUrl });
}

/**
 * 打开添加任务浮层
 */
function openModal() {
  // 重置为新增模式
  modalTitle.textContent = '添加新任务';
  submitTaskBtn.textContent = '添加任务';
  editingTaskIdInput.value = '';

  addTaskModal.classList.add('active');
  promptInput.focus();
}

/**
 * 关闭浮层
 */
function closeModal() {
  addTaskModal.classList.remove('active');
  // 清空表单
  promptInput.value = '';
  maxRetriesInput.value = '3';
  editingTaskIdInput.value = '';
  // 重置为新增模式
  modalTitle.textContent = '添加新任务';
  submitTaskBtn.textContent = '添加任务';
}

/**
 * 提交新任务或更新任务
 */
async function handleSubmitTask() {
  const prompt = promptInput.value.trim();

  if (!prompt) {
    alert('请输入提示词内容');
    return;
  }

  const editingTaskId = editingTaskIdInput.value;
  const isEditMode = !!editingTaskId;

  // AIDEV-NOTE: 解析多步骤任务
  // 使用 "--------" 作为分隔符将任务分成多个步骤
  const STEP_SEPARATOR = '--------';
  const hasSteps = prompt.includes(STEP_SEPARATOR);

  let steps: TaskStep[] | undefined = undefined;
  let currentStepIndex: number | undefined = undefined;

  if (hasSteps) {
    // 分割成多个步骤
    const stepContents = prompt
      .split(STEP_SEPARATOR)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (stepContents.length > 1) {
      steps = stepContents.map((content, index) => ({
        index,
        content,
        status: TaskStatus.PENDING
      }));
      currentStepIndex = 0;

      addDebugLog('info', `Multi-step task detected, ${steps.length} steps total`);
    }
  }

  if (isEditMode) {
    // 编辑模式：更新现有任务
    await TaskStorage.updateTask(editingTaskId, {
      taskType: taskTypeSelect.value as TaskType,
      prompt,
      maxRetries: parseInt(maxRetriesInput.value),
      steps,
      currentStepIndex,
      // 重置错误和重试计数
      error: undefined,
      retryCount: 0
    });

    addDebugLog('success', 'Task updated successfully');
  } else {
    // 新增模式：创建新任务
    const newTask: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      taskType: taskTypeSelect.value as TaskType,
      prompt,
      status: TaskStatus.PENDING,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: parseInt(maxRetriesInput.value),
      // 添加多步骤任务支持
      steps,
      currentStepIndex
    };

    await TaskStorage.addTask(newTask);
    addDebugLog('success', 'Task added successfully');

    // 通知 background 有新任务
    chrome.runtime.sendMessage({ type: 'NEW_TASK_ADDED' });
  }

  closeModal();
}

/**
 * 快捷录入 - 键盘事件处理
 * Enter: 提交
 * Shift+Enter: 换行
 */
function handleQuickInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleQuickSubmit();
  }
}

/**
 * 快捷录入 - 自动调整高度
 */
function handleQuickInputResize() {
  // Reset height to auto to get the correct scrollHeight
  quickInput.style.height = 'auto';
  // Set to scrollHeight but cap at max-height (handled by CSS)
  quickInput.style.height = Math.min(quickInput.scrollHeight, 120) + 'px';
}

/**
 * 快捷录入 - 提交任务
 */
async function handleQuickSubmit() {
  const prompt = quickInput.value.trim();

  if (!prompt) {
    return;
  }

  // 解析多步骤任务
  const STEP_SEPARATOR = '--------';
  const hasSteps = prompt.includes(STEP_SEPARATOR);

  let steps: TaskStep[] | undefined = undefined;
  let currentStepIndex: number | undefined = undefined;

  if (hasSteps) {
    const stepContents = prompt
      .split(STEP_SEPARATOR)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (stepContents.length > 1) {
      steps = stepContents.map((content, index) => ({
        index,
        content,
        status: TaskStatus.PENDING
      }));
      currentStepIndex = 0;

      addDebugLog('info', `Quick add: Multi-step task, ${steps.length} steps`);
    }
  }

  // 创建新任务 (默认类型为 text，重试次数为 0)
  const newTask: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    taskType: TaskType.TEXT,
    prompt,
    status: TaskStatus.PENDING,
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 0,
    steps,
    currentStepIndex
  };

  await TaskStorage.addTask(newTask);
  addDebugLog('success', 'Quick add: Task created');

  // 通知 background 有新任务
  chrome.runtime.sendMessage({ type: 'NEW_TASK_ADDED' });

  // 清空输入框并保持聚焦
  quickInput.value = '';
  quickInput.style.height = 'auto';
  quickInput.focus();
}

/**
 * 开始执行任务
 */
async function startTask(taskId: string) {
  chrome.runtime.sendMessage({
    type: 'START_TASK',
    taskId
  });
}

/**
 * 停止任务（暂停）
 */
async function stopTask(taskId: string) {
  console.log('[Sidepanel] stopTask 被调用:', taskId);
  addDebugLog('info', 'Pausing task...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'STOP_TASK',
      taskId
    });

    console.log('[Sidepanel] 暂停响应:', response);
    addDebugLog('success', 'Pause command sent');

    // 手动触发刷新任务列表
    setTimeout(() => {
      console.log('[Sidepanel] 主动刷新任务列表');
      loadTasks();
    }, 500);

  } catch (error) {
    console.error('[Sidepanel] 暂停任务失败:', error);
    addDebugLog('error', `Pause failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * 重试任务
 */
async function retryTask(taskId: string) {
  // 重置任务状态为待执行，清除错误信息
  await TaskStorage.updateTask(taskId, {
    status: TaskStatus.PENDING,
    error: undefined,
    retryCount: 0
  });

  // 通知 background 重新执行
  chrome.runtime.sendMessage({
    type: 'START_TASK',
    taskId
  });

  addDebugLog('info', 'Task reset, preparing to retry');
}

/**
 * 编辑任务
 */
async function editTask(taskId: string) {
  const tasks = await TaskStorage.getAllTasks();
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    alert('任务不存在');
    return;
  }

  // 切换为编辑模式
  modalTitle.textContent = '编辑任务';
  submitTaskBtn.textContent = '保存修改';
  editingTaskIdInput.value = taskId;

  // 填充表单
  taskTypeSelect.value = task.taskType;
  promptInput.value = task.prompt;
  maxRetriesInput.value = task.maxRetries.toString();

  addTaskModal.classList.add('active');
  promptInput.focus();
}

/**
 * 打开扩展管理页面
 */
function openExtensionPage() {
  chrome.runtime.sendMessage({
    type: 'OPEN_EXTENSION_PAGE'
  });
}

/**
 * 添加调试日志
 */
function addDebugLog(level: 'info' | 'success' | 'warning' | 'error', message: string) {
  // const emptyMsg = debugContent.querySelector('.log-empty'); // <-- REMOVE THIS LINE
  // if (emptyMsg) { // <-- REMOVE THIS LINE
  //   emptyMsg.remove(); // <-- REMOVE THIS LINE
  // }

  const time = new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const logLine = document.createElement('div');
  logLine.className = `log-line ${level}`;
  logLine.textContent = `${time} ${message}`;
  debugContent.appendChild(logLine);

  // 自动滚动到底部
  debugContent.scrollTop = debugContent.scrollHeight;

  // 保持最多50条日志
  const items = debugContent.querySelectorAll('.log-line');
  if (items.length > 100) {
    items[0].remove();
  }
}

/**
 * 切换控制台显示状态
 */
async function toggleConsole() {
  const isHidden = logPanel.classList.toggle('hidden');
  toggleConsoleBtn.classList.toggle('active', !isHidden);

  // 保存状态
  await chrome.storage.local.set({ consoleVisible: !isHidden });
}

/**
 * 初始化控制台显示状态
 */
async function initConsoleState() {
  const result = await chrome.storage.local.get('consoleVisible');
  // 默认显示 (undefined 或 true)
  const isVisible = result.consoleVisible !== false;

  logPanel.classList.toggle('hidden', !isVisible);
  toggleConsoleBtn.classList.toggle('active', isVisible);
}
