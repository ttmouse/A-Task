import { Task, TaskStatus } from '../types/task.js';

// AIDEV-NOTE: 适配器基类定义了所有网站适配器必须实现的接口
// 每个网站的具体实现需要继承这个基类

export abstract class BaseAdapter {
  protected task: Task;

  constructor(task: Task) {
    this.task = task;
  }

  /**
   * 提交任务到目标网站
   * @returns 是否提交成功
   */
  abstract submitTask(): Promise<boolean>;

  /**
   * 检查任务是否完成
   * @returns 任务状态：'completed' | 'running' | 'failed'
   */
  abstract checkStatus(): Promise<TaskStatus>;

  /**
   * 获取生成结果（可选）
   * @returns 结果数据
   */
  abstract getResult(): Promise<any>;

  /**
   * 清理和重置
   */
  abstract cleanup(): Promise<void>;

  /**
   * 判断是否需要重试
   * @param error 错误信息
   * @returns 是否需要重试
   */
  shouldRetry(error: string): boolean {
    // AIDEV-TODO: 根据不同错误类型决定是否重试
    // 例如：网络错误需要重试，验证错误不需要重试
    const retryableErrors = [
      'network',
      'timeout',
      'rate limit'
    ];

    return retryableErrors.some(err => error.toLowerCase().includes(err));
  }
}
