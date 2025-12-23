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

// 连接状态元素
const statusDot = document.getElementById('statusDot') as HTMLSpanElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const manualInjectBtn = document.getElementById('manualInjectBtn') as HTMLButtonElement;
const pageStatusDot = document.getElementById('pageStatusDot') as HTMLSpanElement;
const pageStatusText = document.getElementById('pageStatusText') as HTMLSpanElement;
const pageStatusDetail = document.getElementById('pageStatusDetail') as HTMLSpanElement;
const checkPageStatusBtn = document.getElementById('checkPageStatusBtn') as HTMLButtonElement;
const manualPageStatusBtnDefaultText = checkPageStatusBtn.textContent?.trim() || '🔍 手动检测';

// 调试面板元素
const debugPanel = document.getElementById('debugPanel') as HTMLDivElement;
const debugContent = document.getElementById('debugContent') as HTMLDivElement;
const toggleDebugBtn = document.getElementById('toggleDebugBtn') as HTMLButtonElement;

// 表单元素
const siteSelect = document.getElementById('siteSelect') as HTMLSelectElement;
const taskTypeSelect = document.getElementById('taskTypeSelect') as HTMLSelectElement;
const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
const maxRetriesInput = document.getElementById('maxRetriesInput') as HTMLInputElement;
const editingTaskIdInput = document.getElementById('editingTaskId') as HTMLInputElement;

type PageIndicatorState = TaskStatus | 'idle' | 'checking' | 'unknown';
let currentPageStatus: PageIndicatorState = 'idle';
let manualPageStatusAvailable = false;
let manualPageStatusChecking = false;

// 事件监听
panelTitle.addEventListener('click', openExtensionPage);
guideBtn.addEventListener('click', openGuide);
addTaskBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
submitTaskBtn.addEventListener('click', handleSubmitTask);
toggleDebugBtn.addEventListener('click', toggleDebugPanel);
manualInjectBtn.addEventListener('click', handleManualInject);
checkPageStatusBtn.addEventListener('click', handleManualPageStatusCheck);

// 初始化
setManualPageStatusCheckEnabled(false);
init();

async function init() {
  await loadTasks();

  // 检测连接状态
  checkConnectionStatus();

  // 定期检测连接状态
  setInterval(checkConnectionStatus, 10000); // 每10秒检测一次

  // 监听存储变化
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
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
      const detail = formatPageStatusDetail({
        source: message.source,
        taskId: message.taskId,
        timestamp: message.timestamp
      });
      updatePageStatus(message.status as TaskStatus, detail);
    }
  });
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
  const classes = ['page-checking', 'page-running', 'page-waiting', 'page-error', 'page-idle'];
  pageStatusDot.classList.remove(...classes);

  let text = '等待任务';
  let detailText = detail || '尚未收到来自页面的状态';

  switch (state) {
    case 'checking':
      pageStatusDot.classList.add('page-checking');
      text = '检测中...';
      detailText = detail || '正在与页面通信';
      break;
    case TaskStatus.RUNNING:
      pageStatusDot.classList.add('page-running');
      text = '页面生成中';
      detailText = detail || '检测到 Gemini 正在生成内容';
      break;
    case TaskStatus.COMPLETED:
      pageStatusDot.classList.add('page-waiting');
      text = '生成完成';
      detailText = detail || '页面已生成完毕，处于等待状态';
      break;
    case TaskStatus.PENDING:
      pageStatusDot.classList.add('page-waiting');
      text = '等待执行';
      detailText = detail || '任务尚未开始';
      break;
    case TaskStatus.FAILED:
      pageStatusDot.classList.add('page-error');
      text = '检测到错误';
      detailText = detail || '请查看调试日志';
      break;
    case 'unknown':
      pageStatusDot.classList.add('page-idle');
      text = '状态未知';
      detailText = detail || '等待来自页面的状态';
      break;
    default:
      pageStatusDot.classList.add('page-idle');
      text = '等待任务';
      detailText = detail || '尚未收到来自页面的状态';
      break;
  }

  pageStatusText.textContent = text;
  pageStatusDetail.textContent = detailText;
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
  // 清除所有状态类
  statusDot.classList.remove('checking', 'connected', 'disconnected');

  switch (status) {
    case 'checking':
      statusDot.classList.add('checking');
      statusText.textContent = '检测中...';
      manualInjectBtn.style.display = 'none';
      if (isPageStatusIdleState()) {
        updatePageStatus('checking', '正在检测页面连接状态...');
      }
      setManualPageStatusCheckEnabled(false);
      break;
    case 'connected':
      statusDot.classList.add('connected');
      statusText.textContent = '已连接到页面';
      manualInjectBtn.style.display = 'none';
      if (isPageStatusIdleState()) {
        updatePageStatus('idle', '已连接，等待任务或手动检测');
      }
      setManualPageStatusCheckEnabled(true);
      break;
    case 'disconnected':
      statusDot.classList.add('disconnected');
      statusText.textContent = '未连接 - 请打开 Gemini 页面';
      manualInjectBtn.style.display = 'inline-block';
      updatePageStatus('unknown', '未连接，无法检测页面状态');
      setManualPageStatusCheckEnabled(false);
      break;
  }
}

/**
 * 手动注入 content script
 */
async function handleManualInject() {
  addDebugLog('info', '🔧 尝试手动注入 Content Script...');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'MANUAL_INJECT' });

    if (response?.success) {
      addDebugLog('success', '✅ 手动注入成功！');
      // 立即重新检测连接状态
      setTimeout(checkConnectionStatus, 1000);
    } else {
      addDebugLog('error', `❌ 手动注入失败: ${response?.error || '未知错误'}`);
    }
  } catch (error) {
    addDebugLog('error', `❌ 手动注入异常: ${error instanceof Error ? error.message : '未知错误'}`);
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
  checkPageStatusBtn.textContent = '检测中...';
  updatePageStatus('checking', '正在手动检测页面状态...');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'REQUEST_PAGE_STATUS' });

    if (response?.success && response.status) {
      updatePageStatus(response.status as TaskStatus, formatPageStatusDetail({
        source: 'manual',
        timestamp: Date.now(),
        note: '手动检测'
      }));
    } else {
      updatePageStatus('unknown', response?.error || '无法检测页面状态');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '手动检测失败';
    updatePageStatus('unknown', message);
  } finally {
    manualPageStatusChecking = false;
    checkPageStatusBtn.textContent = manualPageStatusBtnDefaultText;
    checkPageStatusBtn.disabled = !manualPageStatusAvailable;
  }
}

/**
 * 加载任务列表
 */
async function loadTasks() {
  const tasks = await TaskStorage.getAllTasks();

  if (tasks.length === 0) {
    taskList.innerHTML = '';
    taskList.appendChild(emptyState);
    return;
  }

  // 移除空状态
  if (taskList.contains(emptyState)) {
    taskList.removeChild(emptyState);
  }

  // 渲染任务列表
  taskList.innerHTML = tasks.map(task => renderTaskItem(task)).join('');

  // 绑定任务操作事件
  bindTaskActions();
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

  const siteText = {
    [SiteType.GEMINI]: 'Gemini',
    [SiteType.CHATGPT]: 'ChatGPT'
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
          ${task.status === TaskStatus.PENDING ? '<button class="start-task" title="开始执行">▶</button>' : ''}
          ${task.status === TaskStatus.RUNNING ? '<button class="stop-task" title="暂停">⏸</button>' : ''}
          ${task.status === TaskStatus.FAILED || task.status === TaskStatus.COMPLETED ? '<button class="retry-task" title="重试">🔄</button>' : ''}
          ${task.status === TaskStatus.PENDING || task.status === TaskStatus.FAILED ? '<button class="edit-task" title="编辑">✏️</button>' : ''}
          <button class="delete-task" title="删除">🗑</button>
        </div>
      </div>
      <div class="task-content">${task.prompt}</div>
      <div class="task-meta">
        <span>${siteText[task.siteType]}</span>
        <span>${taskTypeText[task.taskType]}</span>
        <span>${createdDate}</span>
        ${stepInfo}
        ${task.retryCount > 0 ? `<span>重试: ${task.retryCount}/${task.maxRetries}</span>` : ''}
      </div>
      ${task.error ? `<div style="color: #d32f2f; font-size: 12px; margin-top: 8px;">错误: ${task.error}</div>` : ''}
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

      addDebugLog('info', `✅ 检测到多步骤任务，共 ${steps.length} 个步骤`);
    }
  }

  if (isEditMode) {
    // 编辑模式：更新现有任务
    await TaskStorage.updateTask(editingTaskId, {
      siteType: siteSelect.value as SiteType,
      taskType: taskTypeSelect.value as TaskType,
      prompt,
      maxRetries: parseInt(maxRetriesInput.value),
      steps,
      currentStepIndex,
      // 重置错误和重试计数
      error: undefined,
      retryCount: 0
    });

    addDebugLog('success', '✅ 任务已更新');
  } else {
    // 新增模式：创建新任务
    const newTask: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      siteType: siteSelect.value as SiteType,
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
    addDebugLog('success', '✅ 任务已添加');

    // 通知 background 有新任务
    chrome.runtime.sendMessage({ type: 'NEW_TASK_ADDED' });
  }

  closeModal();
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
  addDebugLog('info', '⏸ 正在暂停任务...');

  chrome.runtime.sendMessage({
    type: 'STOP_TASK',
    taskId
  });

  addDebugLog('success', '✅ 已发送暂停指令');
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

  addDebugLog('info', '🔄 任务已重置，准备重新执行');
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
  siteSelect.value = task.siteType;
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
 * 切换调试面板
 */
function toggleDebugPanel() {
  debugPanel.classList.toggle('collapsed');
  toggleDebugBtn.textContent = debugPanel.classList.contains('collapsed') ? '展开' : '收起';
}

/**
 * 添加调试日志
 */
function addDebugLog(level: 'info' | 'success' | 'warning' | 'error', message: string) {
  // 移除空状态提示
  const emptyMsg = debugContent.querySelector('.debug-empty');
  if (emptyMsg) {
    emptyMsg.remove();
  }

  // 创建日志项
  const debugItem = document.createElement('div');
  debugItem.className = `debug-item ${level}`;

  const time = new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  debugItem.innerHTML = `
    <span class="debug-item-time">${time}</span>
    <span class="debug-item-message">${message}</span>
  `;

  debugContent.appendChild(debugItem);

  // 自动滚动到底部
  debugContent.scrollTop = debugContent.scrollHeight;

  // 保持最多50条日志
  const items = debugContent.querySelectorAll('.debug-item');
  if (items.length > 50) {
    items[0].remove();
  }

  // 自动展开面板
  if (debugPanel.classList.contains('collapsed')) {
    debugPanel.classList.remove('collapsed');
    toggleDebugBtn.textContent = '收起';
  }
}
