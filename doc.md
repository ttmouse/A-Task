下面是对图片中全部可读文本的完整转写与整理，我没有做内容改写，只做了结构化排版与 Markdown 化，方便你直接复制、版本控制、或作为项目规范使用。

⸻

通用的项目示例模板

你可以直接将其作为 Claude Code 的“宪法 / 器官”。

⸻

层级一：根目录主控文档（/README.md）

地位：系统的「灵魂」与强制决策

# Project FractalFlow（根目录）

## # 核心同步协议（Mandatory）

1. **“原子更新规则”**：任何功能、架构、写法更新，必须在代码修改完成后，【立即同步更新对应目录的子文档】。
2. **“逆向映射链”**：文件变更 → 更新文件 Header → 更新所属文件夹 MD →（若影响全局）更新主 MD。
3. **“分形自洽”**：确保系统在任何一个子目录下，Claude 都能通过该目录的 MD 理解当前世界观。

## ## 项目结构

- `/core`：领域驱动核心逻辑  
- `/api`：外部通信网关  
- `/infra`：基础设施与持久化  

> “Keep the map aligned with the terrain, or the terrain will be lost.”


⸻

层级二：文件夹级架构说明（/src/core/.folder.md）

地位：局部地图（三行极简原则）

# Folder: /src/core

1. **“地位”**：系统心脏，处理所有业务状态转换与领域规则，不依赖外部框架。
2. **“逻辑”**：接收由 /api 传入的 DTO，通过 Domain Service 处理，返回领域对象。
3. **“约束”**：所有计算必须幂等，严禁直接调用 /infra。

## ## 成员清单

- `user_entity.py`：用户核心领域模型（State Buffer）
- `auth_service.py`：鉴权逻辑流（Logic Processor）
- `validator.py`：领域规则校验器（Gatekeeper）

⚠️ **触发器**：一旦本文件夹新增文件或架构逻辑调整，请立即重写此文档。


⸻

层级三：文件开头注释（/src/core/auth_service.py）

地位：细胞级信息（In / Out / Pos 协议）

"""
[INPUT]: (Credentials, UserRepo_Interface) - 原始凭证与用户数据访问接口。
[OUTPUT]: (AuthToken, SessionContext) | Exception - 授权令牌或会话上下文。
[POS]: 位于 /core 中枢位置，作为 api 层与 data 层的逻辑粘合剂。

[PROTOCOL]:
1. 一旦本文件逻辑变更，必须同步更新此 Header。
2. 更新后必须校验 /src/core/.folder.md 描述是否依然准确。
"""

class AuthService:
    # ... 业务逻辑 ...
    def authenticate(self, creds):
        pass


⸻

示例深度解析

1. 解决了 AI 的「中段失忆」（Context Mid-loss）

AI 最大的问题不是记不住，而是 “抓不住重点”。

传统的 README 太长，AI 读取时可能忘了前面的结构。
你的方案：将信息密度压缩到“最近距离”。
	•	根目录：全局世界观
	•	文件夹 MD：局部世界观（3 行）
	•	文件 Header：即时世界观

👉 Attention 权重被强制聚焦，不会在数万行代码中迷失。

⸻

2. 建立了「熵减循环」（Self-Healing Loop）

软件腐化的本质 = 文档与代码脱节。

你的机制是：用「一旦……必须……」的触发器（Trigger），
把文档变成代码修改的“副作用”。

在 Claude Code 执行任务时，它是一个动作序列。
你把“同步文档”嵌进了动作序列的末端 ——
👉 系统具备了 自愈能力。

⸻

3. 分形结构的「全息映射」（Holographic Projection）
	•	局部影响整体：
当 auth_service.py 的 Input 改变了，AI 会被迫查看文件级 MD。
	•	整体约束局部：
当文件夹 MD 写明「严禁直接调用 /infra」，
AI 在修改具体文件时，会因为刚刚读过这个约束而自动产生逻辑剪枝。

👉 剪枝不是通过 prompt，而是通过结构。

⸻

4. GEB 的真实实践：自指与同构

这不仅是管理，这是 一种元编程。
	•	文件在描述自己如何被修改
	•	文件夹在描述文件如何协作
	•	根目录在描述文件夹如何共生

结果：
Claude 不再是一个“外来的修补工”，
它变成了这个生长系统的一部分，
在修改代码的同时，也在重塑自己的思维引导。

⸻

操作建议

把这套规则写进项目的：
	•	.claudecode.md
	•	或项目根目录的 .cursorrules（如果你配合 Cursor 使用）

并加上一句：

“你是这个分形系统的守护者。
任何时候你感到逻辑模糊，请先通过更新各级 MD 来校准你的认知。”


⸻
