// [IN]: Task Object, Storage, Adapter
// [OUT]: Execution Flow Control, Status Updates
// [POS]: Core Layer / Workflow Orchestrator
// Protocol: When updated, sync this header + src/core/.folder.md

import { Task, TaskStatus } from '../types/task.js';
import { TaskStorage } from '../storage/task-storage.js';
import { BaseAdapter } from '../adapters/base-adapter.js';

// AIDEV-NOTE: 多步骤任务执行器
// 负责管理任务执行流程，支持多步骤任务的依次执行
// 执行规则：
// 1. 等待当前步骤完成后再执行下一步
// 2. 如果某个步骤失败，停止后续步骤
// 3. 所有步骤完成后，任务状态设为 completed

export class TaskExecutor {
  private adapter: BaseAdapter;
  private task: Task;
  private checkInterval: number = 2000; // 检查间隔：2秒

  constructor(adapter: BaseAdapter, task: Task) {
    this.adapter = adapter;
    this.task = task;
  }

  /**
   * 执行任务（支持多步骤）
   */
  async execute(): Promise<void> {
    try {
      // 如果是多步骤任务
      if (this.task.steps && this.task.steps.length > 0) {
        await this.executeMultiStep();
      } else {
        // 单步骤任务
        await this.executeSingleStep();
      }
    } catch (error) {
      console.error('[TaskExecutor] 执行失败:', error);
      await TaskStorage.updateTask(this.task.id, {
        status: TaskStatus.FAILED,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * 执行单步骤任务
   */
  private async executeSingleStep(): Promise<void> {
    // 标记任务为执行中
    const startedAt = Date.now();
    await TaskStorage.updateTask(this.task.id, {
      status: TaskStatus.RUNNING,
      startedAt
    });
    this.task.status = TaskStatus.RUNNING;
    this.task.startedAt = startedAt;

    // 提交任务
    const submitted = await this.adapter.submitTask();
    if (!submitted) {
      throw new Error('任务提交失败');
    }

    // 轮询检查状态
    await this.waitForCompletion();

    // 标记任务完成
    await TaskStorage.updateTask(this.task.id, {
      status: TaskStatus.COMPLETED,
      completedAt: Date.now()
    });
  }

  /**
   * AIDEV-NOTE: 执行多步骤任务
   * 流程：
   * 1. 依次执行每个步骤
   * 2. 等待当前步骤完成后再执行下一步
   * 3. 如果某步失败，停止后续执行
   */
  private async executeMultiStep(): Promise<void> {
    if (!this.task.steps) return;

    // 标记任务为执行中
    const startedAt = Date.now();
    await TaskStorage.updateTask(this.task.id, {
      status: TaskStatus.RUNNING,
      startedAt,
      currentStepIndex: 0
    });
    this.task.status = TaskStatus.RUNNING;
    this.task.startedAt = startedAt;
    this.task.currentStepIndex = 0;

    // 依次执行每个步骤
    for (let i = 0; i < this.task.steps.length; i++) {
      console.log(`[TaskExecutor] 执行步骤 ${i + 1}/${this.task.steps.length}`);

      // 更新当前步骤索引
      await TaskStorage.updateTask(this.task.id, {
        currentStepIndex: i
      });
      this.task.currentStepIndex = i;

      // 执行当前步骤
      const success = await this.executeStep(i);

      if (!success) {
        // AIDEV-NOTE: 步骤失败，停止后续执行
        console.error(`[TaskExecutor] 步骤 ${i + 1} 失败，停止后续步骤`);
        await TaskStorage.updateTask(this.task.id, {
          status: TaskStatus.FAILED,
          completedAt: Date.now()
        });
        return;
      }

      // 如果不是最后一步，需要清理当前状态，准备下一步
      if (i < this.task.steps.length - 1) {
        await this.adapter.cleanup();
        console.log(`[TaskExecutor] 步骤 ${i + 1} 完成，准备执行下一步`);
      }
    }

    // 所有步骤完成
    await TaskStorage.updateTask(this.task.id, {
      status: TaskStatus.COMPLETED,
      completedAt: Date.now()
    });

    console.log('[TaskExecutor] 所有步骤执行完成');
  }

  /**
   * 执行单个步骤
   * @param stepIndex 步骤索引
   * @returns 是否成功
   */
  private async executeStep(stepIndex: number): Promise<boolean> {
    try {
      this.task.currentStepIndex = stepIndex;
      // 更新步骤状态为执行中
      await TaskStorage.updateStepStatus(
        this.task.id,
        stepIndex,
        TaskStatus.RUNNING
      );
      this.updateLocalStep(stepIndex, TaskStatus.RUNNING);

      // 提交步骤内容
      const submitted = await this.adapter.submitTask();
      if (!submitted) {
        await TaskStorage.updateStepStatus(
          this.task.id,
          stepIndex,
          TaskStatus.FAILED,
          '提交失败'
        );
        return false;
      }

      // 等待步骤完成
      await this.waitForCompletion();

      // 更新步骤状态为完成
      await TaskStorage.updateStepStatus(
        this.task.id,
        stepIndex,
        TaskStatus.COMPLETED
      );
      this.updateLocalStep(stepIndex, TaskStatus.COMPLETED);

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await TaskStorage.updateStepStatus(
        this.task.id,
        stepIndex,
        TaskStatus.FAILED,
        errorMsg
      );
      this.updateLocalStep(stepIndex, TaskStatus.FAILED, errorMsg);
      return false;
    }
  }

  /**
   * 等待任务完成
   */
  private async waitForCompletion(): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        try {
          const status = await this.adapter.checkStatus();

          if (status === TaskStatus.COMPLETED) {
            resolve();
          } else if (status === TaskStatus.FAILED) {
            reject(new Error('任务执行失败'));
          } else {
            // 继续轮询
            setTimeout(checkStatus, this.checkInterval);
          }
        } catch (error) {
          reject(error);
        }
      };

      checkStatus();
    });
  }

  /**
   * 更新当前实例中的步骤状态，保证适配器读取的 step index 与状态同步
   */
  private updateLocalStep(stepIndex: number, status: TaskStatus, error?: string): void {
    if (!this.task.steps || !this.task.steps[stepIndex]) return;
    const step = this.task.steps[stepIndex];
    step.status = status;
    if (error) {
      step.error = error;
    }
    if (status === TaskStatus.RUNNING) {
      step.startedAt = Date.now();
    }
    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
      step.completedAt = Date.now();
    }
  }
}
