import { TaskStep, TaskStatus } from '../types/task.js';

// AIDEV-NOTE: 任务内容解析工具
// 功能：将包含分割线的任务内容解析为多个步骤

/**
 * 分割线定义：8个减号
 */
const STEP_SEPARATOR = '--------';

/**
 * 解析任务内容，识别分割线并拆分为步骤
 * @param content 原始任务内容
 * @returns 步骤数组，如果没有分割线则返回 null
 */
export function parseTaskSteps(content: string): TaskStep[] | null {
  // 检查是否包含分割线
  if (!content.includes(STEP_SEPARATOR)) {
    return null;
  }

  // 分割内容
  const parts = content.split(STEP_SEPARATOR);

  // 过滤空内容并创建步骤
  const steps: TaskStep[] = parts
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map((content, index) => ({
      index,
      content,
      status: TaskStatus.PENDING
    }));

  // 如果分割后少于2个步骤，视为无效的多步骤任务
  if (steps.length < 2) {
    return null;
  }

  return steps;
}

/**
 * 检查任务是否是多步骤任务
 * @param content 任务内容
 * @returns 是否包含多个步骤
 */
export function isMultiStepTask(content: string): boolean {
  return content.includes(STEP_SEPARATOR);
}

/**
 * 获取任务的步骤总数
 * @param content 任务内容
 * @returns 步骤数量
 */
export function getStepCount(content: string): number {
  const steps = parseTaskSteps(content);
  return steps ? steps.length : 1;
}
