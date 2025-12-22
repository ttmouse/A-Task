import { TaskStorage } from '../storage/task-storage.js';
import { Task, TaskStatus, TaskType, SiteType } from '../types/task.js';

// DOM 元素
const panelTitle = document.getElementById('panelTitle') as HTMLHeadingElement;
const addTaskBtn = document.getElementById('addTaskBtn') as HTMLButtonElement;
const addTaskModal = document.getElementById('addTaskModal') as HTMLDivElement;
const closeModalBtn = document.getElementById('closeModalBtn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement;
const submitTaskBtn = document.getElementById('submitTaskBtn') as HTMLButtonElement;
const taskList = document.getElementById('taskList') as HTMLDivElement;
const emptyState = document.getElementById('emptyState') as HTMLDivElement;

// 调试面板元素
const debugPanel = document.getElementById('debugPanel') as HTMLDivElement;
const debugContent = document.getElementById('debugContent') as HTMLDivElement;
const toggleDebugBtn = document.getElementById('toggleDebugBtn') as HTMLButtonElement;

// 表单元素
const siteSelect = document.getElementById('siteSelect') as HTMLSelectElement;
const taskTypeSelect = document.getElementById('taskTypeSelect') as HTMLSelectElement;
const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
const maxRetriesInput = document.getElementById('maxRetriesInput') as HTMLInputElement;

// 事件监听
panelTitle.addEventListener('click', openExtensionPage);
addTaskBtn.addEventListener('click', openModal);
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);
submitTaskBtn.addEventListener('click', handleSubmitTask);
toggleDebugBtn.addEventListener('click', toggleDebugPanel);

// 初始化
init();

async function init() {
  await loadTasks();

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
  });
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

  return `
    <div class="task-item" data-task-id="${task.id}">
      <div class="task-header">
        <span class="task-status ${task.status}">${statusText[task.status]}</span>
        <div class="task-actions">
          ${task.status === TaskStatus.PENDING ? '<button class="start-task" title="开始执行">▶</button>' : ''}
          ${task.status === TaskStatus.RUNNING ? '<button class="stop-task" title="停止">⏸</button>' : ''}
          ${task.status === TaskStatus.FAILED || task.status === TaskStatus.COMPLETED ? '<button class="retry-task" title="重试">🔄</button>' : ''}
          <button class="delete-task" title="删除">🗑</button>
        </div>
      </div>
      <div class="task-content">${task.prompt}</div>
      <div class="task-meta">
        <span>${siteText[task.siteType]}</span>
        <span>${taskTypeText[task.taskType]}</span>
        <span>${createdDate}</span>
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
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId) {
        await startTask(taskId);
      }
    });
  });

  // 停止任务
  document.querySelectorAll('.stop-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId) {
        await stopTask(taskId);
      }
    });
  });

  // 重试任务
  document.querySelectorAll('.retry-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId) {
        await retryTask(taskId);
      }
    });
  });

  // 删除任务
  document.querySelectorAll('.delete-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const taskId = (e.target as HTMLElement).closest('.task-item')?.getAttribute('data-task-id');
      if (taskId && confirm('确定要删除这个任务吗？')) {
        await TaskStorage.deleteTask(taskId);
      }
    });
  });
}

/**
 * 打开添加任务浮层
 */
function openModal() {
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
}

/**
 * 提交新任务
 */
async function handleSubmitTask() {
  const prompt = promptInput.value.trim();

  if (!prompt) {
    alert('请输入提示词内容');
    return;
  }

  const newTask: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    siteType: siteSelect.value as SiteType,
    taskType: taskTypeSelect.value as TaskType,
    prompt,
    status: TaskStatus.PENDING,
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: parseInt(maxRetriesInput.value)
  };

  await TaskStorage.addTask(newTask);
  closeModal();

  // 通知 background 有新任务
  chrome.runtime.sendMessage({ type: 'NEW_TASK_ADDED' });
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
 * 停止任务
 */
async function stopTask(taskId: string) {
  chrome.runtime.sendMessage({
    type: 'STOP_TASK',
    taskId
  });
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
