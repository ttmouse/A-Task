// [IN]: chrome.storage.local
// [OUT]: Typed Data (Task[])
// [POS]: Storage Layer / Persistence Wrapper
// Protocol: When updated, sync this header + src/storage/.folder.md

import { Task, TaskStatus } from '../types/task.js';

// AIDEV-NOTE: 使用 chrome.storage.local 持久化任务队列
// 数据结构: { tasks: Task[], config: TaskQueueConfig }
// 支持多步骤任务管理

const STORAGE_KEY = 'a-task-queue';

export class TaskStorage {
  /**
   * 获取单个任务
   */
  static async getTask(taskId: string): Promise<Task | null> {
    const tasks = await this.getAllTasks();
    return tasks.find(t => t.id === taskId) || null;
  }

  /**
   * 获取所有任务
   */
  static async getAllTasks(): Promise<Task[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY]?.tasks || [];
  }

  /**
   * 保存所有任务
   */
  static async saveTasks(tasks: Task[]): Promise<void> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data = result[STORAGE_KEY] || {};
    data.tasks = tasks;
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  /**
   * 添加新任务
   */
  static async addTask(task: Task): Promise<void> {
    const tasks = await this.getAllTasks();
    tasks.push(task);
    await this.saveTasks(tasks);
  }

  /**
   * 更新任务状态
   */
  static async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
    const tasks = await this.getAllTasks();
    const index = tasks.findIndex(t => t.id === taskId);
    if (index !== -1) {
      tasks[index] = { ...tasks[index], ...updates };
      await this.saveTasks(tasks);
    }
  }

  /**
   * 删除任务
   */
  static async deleteTask(taskId: string): Promise<void> {
    const tasks = await this.getAllTasks();
    const filtered = tasks.filter(t => t.id !== taskId);
    await this.saveTasks(filtered);
  }

  /**
   * 获取下一个待执行的任务
   */
  static async getNextPendingTask(): Promise<Task | null> {
    const tasks = await this.getAllTasks();
    return tasks.find(t => t.status === TaskStatus.PENDING) || null;
  }

  /**
   * AIDEV-NOTE: 更新当前步骤状态
   * @param taskId 任务ID
   * @param stepIndex 步骤索引
   * @param status 步骤状态
   * @param error 错误信息（可选）
   */
  static async updateStepStatus(
    taskId: string,
    stepIndex: number,
    status: TaskStatus,
    error?: string
  ): Promise<void> {
    const tasks = await this.getAllTasks();
    const task = tasks.find(t => t.id === taskId);

    if (task && task.steps && task.steps[stepIndex]) {
      task.steps[stepIndex].status = status;
      if (error) {
        task.steps[stepIndex].error = error;
      }

      if (status === TaskStatus.RUNNING) {
        task.steps[stepIndex].startedAt = Date.now();
      } else if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
        task.steps[stepIndex].completedAt = Date.now();
      }

      await this.saveTasks(tasks);
    }
  }

  /**
   * AIDEV-NOTE: 移动到下一个步骤
   * @param taskId 任务ID
   * @returns 是否成功移动（如果没有下一步则返回 false）
   */
  static async moveToNextStep(taskId: string): Promise<boolean> {
    const tasks = await this.getAllTasks();
    const task = tasks.find(t => t.id === taskId);

    if (!task || !task.steps) {
      return false;
    }

    const currentIndex = task.currentStepIndex || 0;
    const nextIndex = currentIndex + 1;

    // 检查是否还有下一步
    if (nextIndex >= task.steps.length) {
      return false;
    }

    // 更新到下一步
    task.currentStepIndex = nextIndex;
    await this.saveTasks(tasks);
    return true;
  }

  /**
   * AIDEV-NOTE: 检查任务的所有步骤是否都已完成
   * @param taskId 任务ID
   * @returns 所有步骤是否完成
   */
  static async areAllStepsCompleted(taskId: string): Promise<boolean> {
    const tasks = await this.getAllTasks();
    const task = tasks.find(t => t.id === taskId);

    if (!task || !task.steps) {
      return false;
    }

    return task.steps.every(step => step.status === TaskStatus.COMPLETED);
  }

  /**
   * AIDEV-NOTE: 检查是否有步骤失败
   * @param taskId 任务ID
   * @returns 是否有失败的步骤
   */
  static async hasFailedStep(taskId: string): Promise<boolean> {
    const tasks = await this.getAllTasks();
    const task = tasks.find(t => t.id === taskId);

    if (!task || !task.steps) {
      return false;
    }

    return task.steps.some(step => step.status === TaskStatus.FAILED);
  }
}
