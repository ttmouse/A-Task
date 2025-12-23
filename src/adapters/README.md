<!-- ⚠️ 触发器：一旦本文件夹新增文件或架构逻辑调整，请立即重写此文档 -->

# /src/adapters

## 三段式架构

1. **地位** - 系统的外部接口层，作为核心业务层与各 AI 网站之间的转换器，隔离不同站点的 DOM 结构差异
2. **逻辑** - 接收来自 TaskExecutor 的任务对象，通过适配器模式转换为特定网站的操作序列（提交、监控、获取结果）
3. **约束** - 每个适配器只负责一个网站，严禁跨站点依赖；所有 DOM 操作必须在适配器内部完成，不得暴露给上层

## 成员清单

- `base-adapter.ts` - **[Interface Definer]** - 定义适配器接口契约，所有具体适配器的抽象基类
- `adapter-factory.ts` - **[Factory]** - 工厂类，根据站点类型创建对应适配器实例
- `chatgpt-adapter.ts` - **[Concrete Implementor]** - ChatGPT 站点适配器，处理 ChatGPT 特有的 DOM 结构和交互逻辑
- `gemini-adapter.ts` - **[Concrete Implementor]** - Gemini 站点适配器，处理 Gemini 特有的 DOM 结构和交互逻辑（含双重稳定检测机制）

## 设计模式

### 适配器模式
```
BaseAdapter (Interface Definer)
    ↑
    ├── ChatGPTAdapter (Concrete Implementor)
    ├── GeminiAdapter (Concrete Implementor)
    └── ... (未来扩展)
```

### 核心接口契约
```typescript
abstract class BaseAdapter {
  abstract submitContent(content: string): Promise<boolean>
  abstract checkStatus(): Promise<TaskStatus>
  abstract getResult(): Promise<any>
  abstract cleanup(): Promise<void>
}
```

## 扩展新站点

要支持新的 AI 网站，需要：

1. 创建新的适配器类（如 `claude-adapter.ts`）
2. 继承 `BaseAdapter` 并标记为 **[Concrete Implementor]**
3. 实现所有抽象方法（submitContent, checkStatus, getResult, cleanup）
4. 在 `adapter-factory.ts` 中注册新适配器
5. 更新本 README.md 的成员清单

## 技术约束

- **单一职责**：每个适配器只负责一个网站的逻辑
- **配置化选择器**：DOM 选择器应使用配置化管理，避免硬编码
- **合规性**：必须遵守目标网站的使用条款，避免过度自动化操作
- **容错性**：需要处理网站 DOM 结构变化的容错逻辑
- **无状态污染**：适配器之间不得共享状态，每次创建新实例
