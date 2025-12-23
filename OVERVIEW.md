# A-Task 项目架构概览

## 项目简介

A-Task 是一个 Chrome 扩展插件，用于管理和自动化多个 AI 网站（ChatGPT、Gemini 等）的任务队列。它允许用户批量提交任务、智能监控完成状态，并自动执行下一个任务。

## 核心功能

- **任务队列管理** - 为多个 AI 网站维护独立的任务列表
- **智能监控** - 监控任务完成状态（如图片生成、对话完成）
- **自动化执行** - 检测到任务完成后自动提交下一个任务
- **多站点支持** - 不同网站有不同的任务配置和监控规则
- **多步骤任务** - 支持复杂的多步骤任务流程

## 技术栈

- **Chrome Extension Manifest V3** - 扩展开发规范
- **TypeScript** - 类型安全的开发语言
- **Content Scripts** - 注入到目标网站进行监控和操作
- **Service Worker (background.ts)** - 后台任务管理和状态同步
- **chrome.storage API** - 任务队列和配置持久化

## 项目结构

```
A-Task/
├── src/                      # 源代码目录
│   ├── adapters/            # 适配器层 - 各AI站点的具体实现
│   ├── core/                # 核心层 - 任务执行引擎
│   ├── storage/             # 存储层 - 任务持久化
│   ├── types/               # 类型定义层
│   ├── utils/               # 工具函数层
│   ├── sidepanel/           # 侧边栏UI
│   ├── pages/               # 扩展页面（popup等）
│   ├── examples/            # 使用示例
│   ├── icons/               # 图标资源
│   ├── markdown/            # Markdown资源
│   ├── background.ts        # Service Worker入口
│   └── content-*.ts         # Content Scripts（各站点）
├── dist/                     # 构建输出目录
├── docs/                     # 项目文档
├── CLAUDE.md                 # AI开发指导文档
├── AI_DOC_PRINCIPLES.md      # 分形文档体系原则
└── OVERVIEW.md               # 本文档（架构概览）
```

## 核心架构设计

### 1. 分层架构

```
┌─────────────────────────────────────┐
│     用户界面层 (UI Layer)           │
│  Sidepanel / Popup / Content UI     │
└─────────────┬───────────────────────┘
              │
┌─────────────┴───────────────────────┐
│   核心业务层 (Core Layer)           │
│   TaskExecutor - 任务执行引擎       │
└─────────────┬───────────────────────┘
              │
┌─────────────┴───────────────────────┐
│   适配器层 (Adapter Layer)          │
│   BaseAdapter → ChatGPT/Gemini...   │
└─────────────┬───────────────────────┘
              │
┌─────────────┴───────────────────────┐
│   存储层 (Storage Layer)            │
│   TaskStorage - chrome.storage.local │
└─────────────────────────────────────┘
```

### 2. 适配器模式（核心设计）

每个 AI 网站都有独立的适配器实现，继承自 `BaseAdapter`：

- **BaseAdapter** - 定义统一接口
- **ChatGPTAdapter** - ChatGPT 网站适配器
- **GeminiAdapter** - Gemini 网站适配器
- **AdapterFactory** - 根据站点类型创建适配器实例

每个适配器实现：
- `submitContent()` - 提交任务到网站
- `checkStatus()` - 检查任务完成状态
- `getResult()` - 获取生成结果
- `cleanup()` - 清理和重置

### 3. 任务生命周期

```
pending → running → completed
              ↓
            failed
```

任务状态管理：
- **pending** - 等待执行
- **running** - 正在执行
- **completed** - 执行成功
- **failed** - 执行失败（支持重试）

### 4. 监控机制

- **MutationObserver** - 监控 DOM 变化
- **定期轮询** - 避免过度监控
- **事件驱动** - 状态更新触发下一任务

## 关键模块说明

### `/src/adapters/` - 适配器层
使用适配器模式为不同AI网站提供统一接口。每个网站的DOM结构、API、交互方式不同，通过适配器抹平差异。

### `/src/core/` - 核心执行引擎
`TaskExecutor` 负责任务的编排和执行，协调适配器、存储、监控等模块。

### `/src/storage/` - 存储持久化
`TaskStorage` 封装 chrome.storage.local API，提供任务队列的 CRUD 操作。

### `/src/types/` - 类型定义
定义项目中所有数据结构（Task、TaskStep、TaskStatus等），确保类型安全。

### `/src/utils/` - 工具函数
提供通用工具，如 Markdown 渲染、任务解析等。

## 开发规范

### 文档体系规范
本项目遵循**分形文档体系原则**，详见 `AI_DOC_PRINCIPLES.md`。

核心要求：
1. 修改代码文件时，必须更新文件头的 INPUT/OUTPUT/POS 注释
2. 新增/删除文件时，必须更新所属文件夹的 README.md
3. 架构变更时，必须更新本文档（OVERVIEW.md）

### 锚点注释规范
- `AIDEV-NOTE:` - 重要实现说明
- `AIDEV-TODO:` - 待实现功能
- `AIDEV-QUESTION:` - 需要确认的设计决策

### Chrome 扩展开发规范
- 必须遵守 Manifest V3 规范
- 优先考虑用户体验和性能
- 遵守目标网站使用条款
- 数据仅在用户授权下获取
- 不能进行大规模自动化抓取

## 关键技术决策

### 为什么使用适配器模式？
不同 AI 网站的 DOM 结构、交互方式、API 完全不同。适配器模式让我们：
1. 统一核心业务逻辑
2. 易于扩展新站点
3. 降低维护成本
4. 隔离站点变更影响

### 为什么使用 Service Worker？
Manifest V3 要求使用 Service Worker 替代 Background Page：
1. 更好的性能和资源管理
2. 生命周期更符合现代浏览器规范
3. 必须使用才能通过 Chrome 商店审核

### 为什么使用 chrome.storage？
1. 持久化存储，浏览器关闭后数据不丢失
2. 支持跨页面/跨脚本访问
3. 异步 API，不阻塞主线程
4. Chrome 扩展的标准存储方案

## 待实现功能

- [ ] 更多 AI 站点适配器（Claude、Midjourney等）
- [ ] 任务导入/导出功能
- [ ] 任务历史记录和统计
- [ ] 批量任务模板
- [ ] 任务优先级和依赖关系

## 开发者快速上手

1. **克隆项目**
   ```bash
   git clone <repo-url>
   cd A-Task
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **构建项目**
   ```bash
   npm run build
   ```

4. **加载扩展到 Chrome**
   - 打开 `chrome://extensions/`
   - 启用"开发者模式"
   - 点击"加载已解压的扩展程序"
   - 选择 `dist/` 目录

5. **开始开发**
   - 查看 `CLAUDE.md` 了解开发规范
   - 查看 `AI_DOC_PRINCIPLES.md` 了解文档规范
   - 查看 `src/examples/` 了解使用示例

## 相关文档

- [CLAUDE.md](./CLAUDE.md) - AI 开发指导文档（开发规范、业务逻辑）
- [AI_DOC_PRINCIPLES.md](./AI_DOC_PRINCIPLES.md) - 分形文档体系原则
- [docs/](./docs/) - 详细技术文档

## 联系方式

如有问题或建议，请提交 Issue 或 PR。
