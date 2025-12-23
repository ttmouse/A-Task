<!-- 一旦本文件夹有任何变化（新增/删除/修改文件），请立即更新本文档 -->

# /src/core

## 架构说明

核心业务层，包含任务执行引擎。负责协调适配器、存储、监控等模块，完成任务的编排和执行。支持单步任务和多步骤任务的执行流程管理。

## 文件清单

- `task-executor.ts` - **[核心执行引擎]** - 任务执行器，负责任务生命周期管理（提交、监控、完成、失败重试）、多步骤任务的依次执行、与适配器和存储层的协调

## 核心职责

### 任务编排
- 单步任务直接执行
- 多步骤任务按顺序依次执行
- 步骤间状态传递和依赖处理

### 状态管理
- 任务状态转换：pending → running → completed/failed
- 步骤状态跟踪
- 失败重试机制

### 协调者角色
```
TaskExecutor
    ↓
    ├── 调用 Adapter（提交任务、检查状态）
    ├── 调用 Storage（保存状态、更新进度）
    └── 触发 监控机制（MutationObserver、定时轮询）
```

## 执行流程

### 单步任务
```
1. TaskExecutor.execute()
2. adapter.submitContent(task.content)
3. 定期 adapter.checkStatus() 轮询
4. 检测到完成 → adapter.getResult()
5. 更新任务状态 → storage.updateTask()
```

### 多步骤任务
```
1. TaskExecutor.executeMultiStep()
2. for each step:
   a. adapter.submitContent(step.content)
   b. 等待当前步骤完成
   c. 如失败 → 停止后续步骤
   d. 如成功 → 继续下一步
3. 所有步骤完成 → 任务状态 = completed
```

## 设计原则

- **单一职责**：TaskExecutor 只负责编排，具体操作委托给适配器
- **依赖倒置**：依赖 BaseAdapter 抽象，不依赖具体适配器
- **开闭原则**：扩展新站点无需修改执行器代码

## 扩展点

- 任务重试策略（当前固定间隔轮询）
- 任务优先级调度
- 任务依赖关系处理
- 并行任务执行（当前串行）

## 注意事项

- 执行器不应包含任何网站特定逻辑
- 所有 DOM 操作必须在适配器中完成
- 状态更新必须持久化到 Storage
- 避免无限轮询，设置合理的超时时间
