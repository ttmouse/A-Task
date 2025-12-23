// AIDEV-NOTE: Popup 页面逻辑
// 任务列表展示和操作入口

/**
 * 初始化 Popup
 */
function initPopup(): void {
  console.log('[Popup] 初始化');

  // 绑定按钮事件
  const guideBtn = document.getElementById('guideBtn');
  const addTaskBtn = document.getElementById('addTaskBtn');
  const settingsBtn = document.getElementById('settingsBtn');

  if (guideBtn) {
    guideBtn.addEventListener('click', openGuide);
  }

  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', addTask);
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', openSettings);
  }

  // 加载任务列表
  loadTasks();
}

/**
 * 打开使用指南（侧边栏）
 */
async function openGuide(): Promise<void> {
  console.log('[Popup] 打开使用指南');

  try {
    // 使用 Chrome Side Panel API 打开侧边栏
    await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
  } catch (error) {
    console.error('[Popup] 打开侧边栏失败:', error);

    // 降级方案：打开新标签页
    chrome.tabs.create({
      url: chrome.runtime.getURL('pages/sidepanel/sidepanel.html')
    });
  }
}

/**
 * 添加任务
 */
function addTask(): void {
  console.log('[Popup] 添加任务');

  // TODO: 实现添加任务的逻辑
  // 可以打开一个新页面或者弹出对话框

  alert('添加任务功能即将实现！\n\n提示：您可以在任务内容中使用 8 个减号 (--------) 分隔多个步骤。');
}

/**
 * 打开设置
 */
function openSettings(): void {
  console.log('[Popup] 打开设置');

  // TODO: 实现设置页面
  alert('设置功能即将实现！');
}

/**
 * 加载任务列表
 */
async function loadTasks(): Promise<void> {
  const taskListElement = document.getElementById('taskList');
  if (!taskListElement) return;

  try {
    // TODO: 从 storage 中加载实际任务
    // const tasks = await TaskStorage.getAllTasks();

    // 临时显示空状态
    taskListElement.innerHTML = `
      <div class="empty-state">
        <i class="ri-inbox-line"></i>
        <p>暂无任务</p>
        <small>点击下方"添加任务"按钮开始</small>
      </div>
    `;

    console.log('[Popup] 任务列表加载完成');
  } catch (error) {
    console.error('[Popup] 加载任务失败:', error);

    taskListElement.innerHTML = `
      <div class="empty-state">
        <i class="ri-error-warning-line"></i>
        <p>加载失败</p>
        <small>请刷新重试</small>
      </div>
    `;
  }
}

/**
 * 渲染任务项
 */
function renderTaskItem(task: any): string {
  const statusIcons = {
    pending: 'ri-time-line',
    running: 'ri-loader-4-line ri-spin',
    completed: 'ri-checkbox-circle-line',
    failed: 'ri-close-circle-line'
  };

  const statusText = {
    pending: '待执行',
    running: '执行中',
    completed: '已完成',
    failed: '失败'
  };

  return `
    <div class="task-item">
      <div class="task-header">
        <div class="task-status ${task.status}">
          <i class="${statusIcons[task.status]}"></i>
          <span>${statusText[task.status]}</span>
        </div>
      </div>
      <div class="task-content">${task.prompt}</div>
      <div class="task-meta">
        <span>
          <i class="ri-global-line"></i>
          ${task.siteType}
        </span>
        ${task.steps ? `
          <span>
            <i class="ri-list-ordered"></i>
            ${task.steps.length} 步
          </span>
        ` : ''}
      </div>
    </div>
  `;
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initPopup);
