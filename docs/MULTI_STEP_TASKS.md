# 多步骤任务功能使用指南

## 功能概述

A-Task 支持在一个任务中包含多个内容段落，使用分割线分隔，系统会依次执行这些步骤。

## 使用方法

### 1. 创建多步骤任务

在任务输入框中输入内容时，使用 **8个减号** `--------` 作为分割线：

```
第一段内容
--------
第二段内容
--------
第三段内容
```

### 2. 执行流程

系统会按以下流程执行：

1. 提交第一段内容到目标网站（如 Gemini、ChatGPT）
2. 等待 AI 完成响应
3. 自动清理并提交第二段内容
4. 等待 AI 完成响应
5. 继续执行后续步骤...

### 3. 错误处理

- 如果某个步骤失败，会**立即停止**后续步骤的执行
- 失败的步骤会记录错误信息
- 整个任务状态会标记为失败

## 代码示例

### 创建多步骤任务

```typescript
import { parseTaskSteps } from './utils/task-parser.js';
import { Task, TaskStatus, SiteType, TaskType } from './types/task.js';

// 用户输入的内容
const userInput = `
生成一个蓝色的天空图片
--------
在这个天空中添加一朵白云
--------
让白云变成粉红色
`;

// 解析步骤
const steps = parseTaskSteps(userInput);

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

  // 多步骤相关字段
  steps: steps || undefined,
  currentStepIndex: steps ? 0 : undefined
};
```

### 执行多步骤任务

```typescript
import { TaskExecutor } from './core/task-executor.js';
import { GeminiAdapter } from './adapters/gemini-adapter.js'; // 假设你有 Gemini 适配器

// 创建适配器
const adapter = new GeminiAdapter(task);

// 创建执行器
const executor = new TaskExecutor(adapter, task);

// 执行任务
await executor.execute();
```

### 检查步骤状态

```typescript
import { TaskStorage } from './storage/task-storage.js';

// 检查所有步骤是否完成
const allCompleted = await TaskStorage.areAllStepsCompleted(task.id);

// 检查是否有失败的步骤
const hasFailed = await TaskStorage.hasFailedStep(task.id);

// 获取任务详情
const tasks = await TaskStorage.getAllTasks();
const myTask = tasks.find(t => t.id === task.id);

if (myTask && myTask.steps) {
  myTask.steps.forEach((step, index) => {
    console.log(`步骤 ${index + 1}: ${step.status}`);
    console.log(`内容: ${step.content}`);
    if (step.error) {
      console.log(`错误: ${step.error}`);
    }
  });
}
```

## 适配器实现要求

如果你要为新的网站创建适配器，需要实现以下方法：

```typescript
import { BaseAdapter } from './adapters/base-adapter.js';
import { TaskStatus } from './types/task.js';

export class YourAdapter extends BaseAdapter {
  /**
   * 提交内容到网站（核心方法）
   * BaseAdapter 会自动调用这个方法，并传入当前步骤的内容
   */
  async submitContent(content: string): Promise<boolean> {
    // 实现：将 content 提交到目标网站
    // 例如：找到输入框，填入 content，点击发送按钮
    return true;
  }

  /**
   * 检查任务状态
   */
  async checkStatus(): Promise<TaskStatus> {
    // 实现：检查 AI 是否完成响应
    // 返回: TaskStatus.COMPLETED | TaskStatus.RUNNING | TaskStatus.FAILED
  }

  /**
   * 获取结果（可选）
   */
  async getResult(): Promise<any> {
    // 实现：获取 AI 生成的结果
    return null;
  }

  /**
   * 清理和重置
   * 在多步骤任务中，每个步骤完成后会调用此方法
   */
  async cleanup(): Promise<void> {
    // 实现：清理当前对话状态，准备下一步
    // 例如：清空输入框、关闭弹窗等
  }
}
```

## 工具函数

### parseTaskSteps

解析任务内容，识别分割线并拆分为步骤。

```typescript
import { parseTaskSteps } from './utils/task-parser.js';

const content = "步骤1\n--------\n步骤2";
const steps = parseTaskSteps(content);
// 返回: [{ index: 0, content: "步骤1", status: "pending" }, ...]
```

### isMultiStepTask

检查任务是否包含多个步骤。

```typescript
import { isMultiStepTask } from './utils/task-parser.js';

const hasSteps = isMultiStepTask(content);
// 返回: true | false
```

### getStepCount

获取任务的步骤总数。

```typescript
import { getStepCount } from './utils/task-parser.js';

const count = getStepCount(content);
// 返回: 步骤数量（至少为 1）
```

## 注意事项

1. **分割线格式**：必须是 8个减号 `--------`，多或少都不会被识别
2. **空白处理**：分割线前后的空白会被自动去除
3. **最少步骤数**：至少需要 2 个有效步骤才会被识别为多步骤任务
4. **状态同步**：每个步骤的状态会实时保存到 `chrome.storage.local`
5. **错误恢复**：如果某步失败，不会自动重试后续步骤，整个任务会标记为失败

## 实际应用场景

### 场景 1：图片生成迭代

```
生成一个森林的图片
--------
在森林中添加一只小鹿
--------
让画面变成黄昏的光线
```

### 场景 2：对话上下文延续

```
请帮我写一个关于人工智能的短文
--------
将这篇短文翻译成英文
--------
总结这篇英文短文的要点
```

### 场景 3：代码迭代开发

```
用 Python 写一个计算斐波那契数列的函数
--------
优化这个函数，使用动态规划
--------
添加单元测试
```
