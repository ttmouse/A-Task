// 任务状态枚举
export enum TaskStatus {
  PENDING = 'pending',      // 待执行
  RUNNING = 'running',      // 执行中
  COMPLETED = 'completed',  // 已完成
  FAILED = 'failed'         // 失败
}

// 任务类型
export enum TaskType {
  TEXT = 'text',           // 文本对话
  IMAGE = 'image'          // 图片生成
}

// 支持的网站
export enum SiteType {
  GEMINI = 'gemini',
  CHATGPT = 'chatgpt'
}

// AIDEV-NOTE: 任务步骤接口 - 支持多步骤任务
// 使用 8个减号 (--------) 分割任务内容为多个步骤
export interface TaskStep {
  index: number;                // 步骤索引
  content: string;              // 步骤内容
  status: TaskStatus;           // 步骤状态
  startedAt?: number;           // 开始执行时间戳
  completedAt?: number;         // 完成时间戳
  error?: string;               // 错误信息
}

// 任务接口
export interface Task {
  id: string;                    // 唯一标识
  siteType: SiteType;           // 目标网站
  taskType: TaskType;           // 任务类型
  prompt: string;               // 原始提示词内容（可能包含分割线）
  status: TaskStatus;           // 任务状态
  createdAt: number;            // 创建时间戳
  startedAt?: number;           // 开始执行时间戳
  completedAt?: number;         // 完成时间戳
  error?: string;               // 错误信息
  retryCount: number;           // 重试次数
  maxRetries: number;           // 最大重试次数

  // 多步骤任务支持
  steps?: TaskStep[];           // 任务步骤列表（如果有分割线）
  currentStepIndex?: number;    // 当前执行的步骤索引
}

// 任务队列配置
export interface TaskQueueConfig {
  maxConcurrentTasks: number;   // 最大并发任务数
  retryDelay: number;            // 重试延迟（毫秒）
}
