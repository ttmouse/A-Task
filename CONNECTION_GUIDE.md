# Content Script 连接问题解决方案

## 问题原因分析

"无法连接到 content script (尝试 5 次)" 错误的主要原因：

### 1. **Content Script 注入时机问题**
- Manifest V3 中，content script 在页面 `document_idle` 时才自动注入
- 如果 Background Service Worker 在 content script 完全初始化前就尝试通信，会导致连接失败

### 2. **页面刷新问题**
- 用户刷新页面后，content script 需要重新注入
- Background 的状态可能还保留着旧的任务引用，导致通信断开

### 3. **SPA 页面动态加载**
- Gemini 等 AI 网站是单页应用（SPA），DOM 可能在页面加载完成后还在动态变化
- Content script 虽然注入了，但可能还没完全初始化消息监听器

### 4. **通信路径**
- 侧边栏 → Background → Content Script → 网页
- 不是侧边栏和网页直接通信，是通过 Background 中转

## 解决方案

我已经实施了以下改进：

### 1. **连接状态指示器**
- 侧边栏顶部新增连接状态显示
- 三种状态：
  - 🟠 **检测中** - 正在检测 content script 连接
  - 🟢 **已连接到页面** - content script 就绪，可以执行任务
  - 🔴 **未连接** - 无法连接，显示手动注入按钮

### 2. **PING/PONG 机制**
- Background 定期向 content script 发送 PING 消息
- Content script 响应 PONG 确认在线
- 超时时间设为 1 秒，快速检测连接状态

### 3. **手动注入按钮**
- 当连接失败时，显示 "🔧 手动注入" 按钮
- 点击后会：
  1. 查找 Gemini 标签页
  2. 使用 `chrome.scripting.executeScript` 手动注入 content script
  3. 等待 500ms 让 content script 初始化
  4. 验证注入是否成功
  5. 更新连接状态

### 4. **自动检测**
- 侧边栏初始化时立即检测连接状态
- 每 10 秒自动检测一次连接状态
- 任务执行前也会先检测连接

## 使用说明

### 正常情况

1. 打开 Gemini 页面（https://gemini.google.com）
2. 打开插件侧边栏
3. 查看顶部连接状态：
   - 如果显示 **"已连接到页面"**（绿点），说明一切正常
   - 可以正常添加和执行任务

### 连接失败处理

如果显示 **"未连接 - 请打开 Gemini 页面"**（红点）：

#### 方案 1：打开/刷新页面
1. 打开 https://gemini.google.com 页面
2. 等待 10 秒（或点击侧边栏任何位置触发手动检测）
3. 状态应该会变为 "已连接"

#### 方案 2：使用手动注入
1. 确保 Gemini 页面已打开
2. 点击 **"🔧 手动注入"** 按钮
3. 查看调试面板的日志：
   - ✅ 手动注入成功
   - 状态会自动更新为 "已连接"

#### 方案 3：重新加载扩展
1. 打开 chrome://extensions/
2. 找到 "A-Task" 扩展
3. 点击 "重新加载" 按钮
4. 刷新 Gemini 页面
5. 重新打开侧边栏

## 技术实现

### 新增功能

#### 1. `background.ts` 新增消息处理
```typescript
case 'CHECK_CONTENT_SCRIPT':
  // 检测 content script 是否就绪
  handleCheckContentScript().then(sendResponse);
  return true;

case 'MANUAL_INJECT':
  // 手动注入 content script
  handleManualInject().then(sendResponse);
  return true;

case 'PING':
  // PING 响应
  sendResponse({ pong: true });
  break;
```

#### 2. `content-gemini.ts` 新增 PING 响应
```typescript
if (message.type === 'PING') {
  sendResponse({ pong: true });
  return;
}
```

#### 3. `sidepanel.ts` 新增功能
- `checkConnectionStatus()` - 定期检测连接状态
- `updateConnectionStatus()` - 更新 UI 显示
- `handleManualInject()` - 处理手动注入

#### 4. `manifest.json` 新增权限
```json
"permissions": [
  "scripting"  // 用于手动注入 content script
]
```

## 调试技巧

### 查看连接状态
- 打开侧边栏，查看顶部的连接指示器
- 查看调试面板的日志输出

### 查看 Console 日志
1. **Background Service Worker 日志**：
   - 打开 chrome://extensions/
   - 找到 A-Task 扩展
   - 点击 "Service Worker" 查看日志

2. **Content Script 日志**：
   - 打开 Gemini 页面
   - 按 F12 打开开发者工具
   - 查看 Console 标签

3. **侧边栏日志**：
   - 打开侧边栏
   - 右键点击侧边栏空白处
   - 选择 "检查"
   - 查看 Console 标签

### 常见问题排查

#### Q: 手动注入失败
**A:** 确保：
1. Gemini 页面已完全加载
2. 扩展有 `scripting` 权限
3. 尝试刷新页面后再注入

#### Q: 连接状态一直显示"检测中"
**A:** 可能原因：
1. 页面还在加载中
2. Content script 被其他扩展冲突
3. 尝试重新加载扩展

#### Q: 手动注入后仍然失败
**A:** 尝试：
1. 刷新 Gemini 页面
2. 重新加载扩展
3. 清除浏览器缓存

## 总结

通过这些改进，插件现在：
- ✅ 可以实时显示连接状态
- ✅ 自动检测 content script 是否就绪
- ✅ 提供手动注入功能作为备选方案
- ✅ 有完整的错误提示和处理流程

这样可以大大减少 "无法连接到 content script" 的错误发生，即使发生也能快速解决！
