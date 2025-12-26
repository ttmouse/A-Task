// INPUT: ../types/task.js (Task, TaskStatus, TaskStep 类型定义)
// OUTPUT: BaseAdapter 抽象类，定义适配器接口（submitContent, checkStatus, getResult, cleanup 等方法）
// POS: 适配器层基类，被所有具体适配器继承（chatgpt-adapter, gemini-adapter 等）
// 一旦本文件被修改，请更新此注释并同步更新 /src/adapters/README.md

import { Task, TaskStatus, TaskStep } from '../types/task.js';

// AIDEV-NOTE: 适配器基类定义了所有网站适配器必须实现的接口
// 每个网站的具体实现需要继承这个基类
// 支持多步骤任务：如果任务包含步骤，将依次执行每个步骤

export abstract class BaseAdapter {
  protected task: Task;

  constructor(task: Task) {
    this.task = task;
  }

  /**
   * 提交任务到目标网站（基础方法）
   * @param content 要提交的内容
   * @returns 是否提交成功
   */
  abstract submitContent(content: string): Promise<boolean>;

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
   * 停止当前任务（默认退回 cleanup，可由子类重写执行更具体的停止逻辑）
   */
  async stopCurrentTask(): Promise<void> {
    await this.cleanup();
  }

  /**
   * AIDEV-NOTE: 提交任务 - 支持多步骤任务
   * 如果任务有多个步骤，提交当前步骤的内容
   * 如果是单步骤任务，提交整个 prompt
   * @returns 是否提交成功
   */
  async submitTask(): Promise<boolean> {
    const content = this.getCurrentStepContent();
    return await this.submitContent(content);
  }

  /**
   * 获取当前步骤的内容
   * @returns 当前步骤内容
   */
  protected getCurrentStepContent(): string {
    // 如果有步骤列表，返回当前步骤的内容
    if (this.task.steps && this.task.steps.length > 0) {
      const currentIndex = this.task.currentStepIndex || 0;
      return this.task.steps[currentIndex]?.content || '';
    }
    // 否则返回整个 prompt
    return this.task.prompt;
  }

  /**
   * 检查是否是多步骤任务
   * @returns 是否有多个步骤
   */
  protected isMultiStepTask(): boolean {
    return !!(this.task.steps && this.task.steps.length > 1);
  }

  /**
   * 获取当前步骤
   * @returns 当前步骤对象
   */
  protected getCurrentStep(): TaskStep | null {
    if (!this.task.steps) return null;
    const currentIndex = this.task.currentStepIndex || 0;
    return this.task.steps[currentIndex] || null;
  }

  /**
   * 检查是否有下一个步骤
   * @returns 是否还有待执行的步骤
   */
  protected hasNextStep(): boolean {
    if (!this.task.steps) return false;
    const currentIndex = this.task.currentStepIndex || 0;
    return currentIndex < this.task.steps.length - 1;
  }

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
