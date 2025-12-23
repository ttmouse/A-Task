<!-- 一旦本文件夹有任何变化（新增/删除/修改文件），请立即更新本文档 -->

# /src/storage

## 架构说明

存储层，封装 chrome.storage.local API，提供任务队列的持久化存储功能。负责任务的 CRUD 操作，确保数据在浏览器关闭后仍然保留。

## 文件清单

- `task-storage.ts` - **[存储管理器]** - 提供任务存储的静态方法（getAllTasks、saveTasks、addTask、updateTask、deleteTask 等），封装 chrome.storage.local API

## 核心职责

### 数据持久化
- 使用 `chrome.storage.local` 存储任务队列
- 数据结构：`{ tasks: Task[], config: TaskQueueConfig }`
- 支持多步骤任务的完整数据结构

### CRUD 操作
- **Create** - `addTask(task)` - 添加新任务
- **Read** - `getAllTasks()` - 获取所有任务
- **Update** - `updateTask(taskId, updates)` - 更新任务状态/内容
- **Delete** - `deleteTask(taskId)` - 删除任务

### 数据查询
- 按站点类型过滤任务
- 按状态过滤任务（pending、running、completed、failed）
- 获取队列中的下一个任务

## 存储结构

```json
{
  "a-task-queue": {
    "tasks": [
      {
        "id": "uuid",
        "site": "chatgpt",
        "content": "任务内容",
        "status": "pending",
        "steps": [...],
        "createdAt": 1234567890,
        "updatedAt": 1234567890
      }
    ],
    "config": {
      "checkInterval": 2000,
      "maxRetries": 3
    }
  }
}
```

## 设计原则

- **静态方法**：TaskStorage 使用静态方法，无需实例化
- **原子操作**：每次读写都是完整的数据，避免部分更新导致数据不一致
- **类型安全**：所有方法使用 TypeScript 类型约束

## 技术细节

### 为什么使用 chrome.storage.local？
1. **持久化**：浏览器关闭后数据不丢失
2. **跨脚本访问**：background、content script、popup 都可访问
3. **异步 API**：不阻塞主线程
4. **扩展标准**：Chrome 扩展的标准存储方案

### 并发问题
chrome.storage.local 的读写是异步的，但不是事务性的。当前实现：
- 每次更新都先读取完整数据
- 修改后再保存完整数据
- 可能存在并发写入覆盖问题（未来优化）

## 扩展点

- 添加事务性更新机制
- 实现数据备份/恢复功能
- 添加数据迁移支持
- 实现数据压缩（如任务历史过多）

## 注意事项

- chrome.storage.local 有容量限制（约 10MB）
- 避免频繁写入，影响性能
- 敏感数据不应存储在 local storage
- 需要处理存储失败的异常情况
