import { Task, TaskStatus } from '../types/task.js';

// AIDEV-NOTE: 使用 chrome.storage.local 持久化任务队列
// 数据结构: { tasks: Task[], config: TaskQueueConfig }

const STORAGE_KEY = 'a-task-queue';

export class TaskStorage {
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
}
