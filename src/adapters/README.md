<!-- 一旦本文件夹有任何变化（新增/删除/修改文件），请立即更新本文档 -->

# /src/adapters

## 架构说明

适配器层，使用适配器模式为不同 AI 网站提供统一接口。每个适配器负责特定网站的任务提交、状态监控和结果获取。核心设计原则是隔离各站点的差异，让上层业务逻辑保持一致。

## 文件清单

- `base-adapter.ts` - **[抽象基类]** - 定义适配器接口，所有适配器必须继承此类并实现 submitContent、checkStatus、getResult、cleanup 等方法
- `adapter-factory.ts` - **[工厂类]** - 根据网站类型（如 'chatgpt'、'gemini'）创建对应的适配器实例
- `chatgpt-adapter.ts` - **[具体适配器]** - ChatGPT 网站的适配器实现，处理 ChatGPT 特有的 DOM 结构和交互逻辑
- `gemini-adapter.ts` - **[具体适配器]** - Gemini 网站的适配器实现，处理 Gemini 特有的 DOM 结构和交互逻辑

## 设计模式

### 适配器模式
```
BaseAdapter (抽象基类)
    ↑
    ├── ChatGPTAdapter
    ├── GeminiAdapter
    └── ... (未来扩展)
```

### 核心接口
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
2. 继承 `BaseAdapter`
3. 实现所有抽象方法
4. 在 `adapter-factory.ts` 中注册新适配器
5. 更新本 README.md

## 注意事项

- 每个适配器只负责一个网站的逻辑
- DOM 选择器应使用配置化管理，避免硬编码
- 必须遵守目标网站的使用条款
- 避免过度自动化操作
- 需要处理网站 DOM 结构变化的容错逻辑
