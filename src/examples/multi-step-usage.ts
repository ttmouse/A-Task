import { Task, TaskStatus, SiteType, TaskType } from './types/task.js';
import { parseTaskSteps } from './utils/task-parser.js';
import { TaskStorage } from './storage/task-storage.js';
import { AdapterFactory } from './adapters/adapter-factory.js';
import { TaskExecutor } from './core/task-executor.js';

/**
 * 多步骤任务使用示例
 *
 * 此文件展示如何创建和执行多步骤任务
 */

// ============================================
// 示例 1: 创建单步骤任务
// ============================================
async function example1_singleStepTask() {
  console.log('=== 示例 1: 单步骤任务 ===');

  // 用户输入的内容（无分割线）
  const userInput = '生成一个蓝色天空的图片';

  // 解析步骤（返回 null，因为没有分割线）
  const steps = parseTaskSteps(userInput);
  console.log('解析结果:', steps); // null

  // 创建任务
  const task: Task = {
    id: crypto.randomUUID(),
    siteType: SiteType.GEMINI,
    taskType: TaskType.IMAGE,
    prompt: userInput,
    status: TaskStatus.PENDING,
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 3,
    steps: steps || undefined,
    currentStepIndex: steps ? 0 : undefined
  };

  // 保存任务
  await TaskStorage.addTask(task);
  console.log('任务已创建:', task.id);

  // 创建适配器并执行
  const adapter = AdapterFactory.create(task);
  const executor = new TaskExecutor(adapter, task);
  await executor.execute();

  console.log('任务执行完成');
}

// ============================================
// 示例 2: 创建多步骤任务
// ============================================
async function example2_multiStepTask() {
  console.log('=== 示例 2: 多步骤任务 ===');

  // 用户输入的内容（包含分割线）
  const userInput = `
生成一个蓝色天空的图片
--------
在天空中添加一朵白云
--------
让白云变成粉红色
`.trim();

  // 解析步骤
  const steps = parseTaskSteps(userInput);
  console.log('解析结果:', steps);
  // 输出: [
  //   { index: 0, content: '生成一个蓝色天空的图片', status: 'pending' },
  //   { index: 1, content: '在天空中添加一朵白云', status: 'pending' },
  //   { index: 2, content: '让白云变成粉红色', status: 'pending' }
  // ]

  // 创建任务
  const task: Task = {
    id: crypto.randomUUID(),
    siteType: SiteType.GEMINI,
    taskType: TaskType.IMAGE,
    prompt: userInput,
    status: TaskStatus.PENDING,
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 3,
    steps: steps || undefined,
    currentStepIndex: steps ? 0 : undefined
  };

  // 保存任务
  await TaskStorage.addTask(task);
  console.log(`任务已创建: ${task.id} (共 ${steps?.length || 1} 个步骤)`);

  // 创建适配器并执行
  const adapter = AdapterFactory.create(task);
  const executor = new TaskExecutor(adapter, task);

  // 执行任务（会依次执行所有步骤）
  await executor.execute();

  console.log('所有步骤执行完成');
}

// ============================================
// 示例 3: 监控任务进度
// ============================================
async function example3_monitorProgress() {
  console.log('=== 示例 3: 监控任务进度 ===');

  // 假设已经有一个正在执行的任务
  const taskId = 'some-task-id';

  // 获取任务详情
  const tasks = await TaskStorage.getAllTasks();
  const task = tasks.find(t => t.id === taskId);

  if (!task) {
    console.log('任务不存在');
    return;
  }

  console.log(`任务状态: ${task.status}`);

  // 如果是多步骤任务
  if (task.steps && task.steps.length > 0) {
    console.log(`总步骤数: ${task.steps.length}`);
    console.log(`当前步骤: ${(task.currentStepIndex || 0) + 1}`);

    // 显示每个步骤的状态
    task.steps.forEach((step, index) => {
      console.log(`步骤 ${index + 1}:`);
      console.log(`  内容: ${step.content}`);
      console.log(`  状态: ${step.status}`);
      if (step.error) {
        console.log(`  错误: ${step.error}`);
      }
    });

    // 检查是否所有步骤完成
    const allCompleted = await TaskStorage.areAllStepsCompleted(taskId);
    console.log(`所有步骤完成: ${allCompleted}`);

    // 检查是否有失败的步骤
    const hasFailed = await TaskStorage.hasFailedStep(taskId);
    console.log(`有失败的步骤: ${hasFailed}`);
  }
}

// ============================================
// 示例 4: 批量创建多步骤任务
// ============================================
async function example4_batchTasks() {
  console.log('=== 示例 4: 批量创建任务 ===');

  const taskContents = [
    `
写一个关于春天的诗
--------
将这首诗翻译成英文
`,
    `
生成一张森林的图片
--------
在森林中添加一只小鹿
--------
调整为黄昏的光线
`,
    `
用 Python 写一个快速排序函数
--------
优化这个函数的性能
--------
添加单元测试
`
  ];

  for (const content of taskContents) {
    const steps = parseTaskSteps(content.trim());

    const task: Task = {
      id: crypto.randomUUID(),
      siteType: SiteType.CHATGPT, // 使用 ChatGPT
      taskType: TaskType.TEXT,
      prompt: content.trim(),
      status: TaskStatus.PENDING,
      createdAt: Date.now(),
      retryCount: 0,
      maxRetries: 3,
      steps: steps || undefined,
      currentStepIndex: steps ? 0 : undefined
    };

    await TaskStorage.addTask(task);
    console.log(`任务已添加: ${task.id} (${steps?.length || 1} 步)`);
  }

  console.log('所有任务已添加到队列');
}

// ============================================
// 示例 5: 从现有任务恢复执行
// ============================================
async function example5_resumeTask() {
  console.log('=== 示例 5: 恢复任务执行 ===');

  // 获取下一个待执行的任务
  const task = await TaskStorage.getNextPendingTask();

  if (!task) {
    console.log('没有待执行的任务');
    return;
  }

  console.log(`准备执行任务: ${task.id}`);

  if (task.steps) {
    console.log(`任务包含 ${task.steps.length} 个步骤`);
  }

  // 创建适配器并执行
  const adapter = AdapterFactory.create(task);
  const executor = new TaskExecutor(adapter, task);
  await executor.execute();

  console.log('任务执行完成');
}

// ============================================
// 示例 6: 错误处理
// ============================================
async function example6_errorHandling() {
  console.log('=== 示例 6: 错误处理 ===');

  const userInput = `
第一步：正常内容
--------
第二步：这一步可能会失败
--------
第三步：如果第二步失败，这一步不会执行
`.trim();

  const steps = parseTaskSteps(userInput);

  const task: Task = {
    id: crypto.randomUUID(),
    siteType: SiteType.GEMINI,
    taskType: TaskType.TEXT,
    prompt: userInput,
    status: TaskStatus.PENDING,
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: 3,
    steps: steps || undefined,
    currentStepIndex: 0
  };

  await TaskStorage.addTask(task);

  try {
    const adapter = AdapterFactory.create(task);
    const executor = new TaskExecutor(adapter, task);
    await executor.execute();
  } catch (error) {
    console.error('任务执行失败:', error);

    // 检查失败的步骤
    const updatedTask = (await TaskStorage.getAllTasks()).find(t => t.id === task.id);
    if (updatedTask?.steps) {
      const failedStep = updatedTask.steps.find(s => s.status === TaskStatus.FAILED);
      if (failedStep) {
        console.log(`步骤 ${failedStep.index + 1} 失败: ${failedStep.error}`);
      }
    }
  }
}

// ============================================
// 导出示例函数供测试使用
// ============================================
export {
  example1_singleStepTask,
  example2_multiStepTask,
  example3_monitorProgress,
  example4_batchTasks,
  example5_resumeTask,
  example6_errorHandling
};

// ============================================
// 如果直接运行此文件，执行示例 2
// ============================================
if (typeof window !== 'undefined') {
  console.log('多步骤任务示例已加载');
  console.log('可用的示例函数:');
  console.log('- example1_singleStepTask()');
  console.log('- example2_multiStepTask()');
  console.log('- example3_monitorProgress()');
  console.log('- example4_batchTasks()');
  console.log('- example5_resumeTask()');
  console.log('- example6_errorHandling()');
}
