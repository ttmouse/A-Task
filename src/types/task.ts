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

// 任务接口
export interface Task {
  id: string;                    // 唯一标识
  siteType: SiteType;           // 目标网站
  taskType: TaskType;           // 任务类型
  prompt: string;               // 提示词内容
  status: TaskStatus;           // 任务状态
  createdAt: number;            // 创建时间戳
  startedAt?: number;           // 开始执行时间戳
  completedAt?: number;         // 完成时间戳
  error?: string;               // 错误信息
  retryCount: number;           // 重试次数
  maxRetries: number;           // 最大重试次数
}

// 任务队列配置
export interface TaskQueueConfig {
  maxConcurrentTasks: number;   // 最大并发任务数
  retryDelay: number;            // 重试延迟（毫秒）
}
