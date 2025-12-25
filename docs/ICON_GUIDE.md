# 图标使用规范 (Icon Usage Guide)

本项目的所有图标必须统一使用开源图标库 [Remix Icon](https://remixicon.com/)。禁止使用 Emoji 或其他非开源图标库的资源作为 UI 图标。

## 1. 图标来源

- **官方网站**: [https://remixicon.com/](https://remixicon.com/)
- **CDN**: `https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css`

## 2. 使用规范

### 2.1 引入方式

在 HTML 文件的 `<head>` 中引入 CSS：

```html
<link href="https://cdn.jsdelivr.net/npm/remixicon@4.2.0/fonts/remixicon.css" rel="stylesheet"/>
```

### 2.2 使用方法

使用 `<i>` 标签并添加对应的类名。

- **线性图标 (Line)**: 使用 `-line` 后缀，如 `ri-add-line`
- **填充图标 (Fill)**: 使用 `-fill` 后缀，如 `ri-add-fill`

示例：

```html
<i class="ri-home-line"></i> <!-- 首页图标 -->
<button class="btn">
  <i class="ri-settings-3-line"></i>
  <span>设置</span>
</button>
```

### 2.3 尺寸规范

- **默认尺寸**: 图标默认继承父元素的字体大小。
- **工具栏图标**: 推荐 `16px` - `18px`。
- **按钮内图标**: 推荐 `14px` - `16px`。
- **空状态大图标**: 推荐 `48px` 或更大。

可以通过 CSS 控制大小：

```css
.icon-small { font-size: 14px; }
.icon-medium { font-size: 18px; }
.icon-large { font-size: 24px; }
```

### 2.4 颜色规范

- 图标颜色应跟随文本颜色 (`currentColor`) 或指定为设计系统中的颜色变量。
- **默认**: `--text-secondary` (#5E5E5E)
- **激活/选中**: `--primary` (#9D5CFF)
- **Hover**: `--text-main` (#222222)

## 3. 禁止事项

- ❌ **禁止使用 Emoji** (如 🔍, 🔧, ✅) 作为 UI 元素。仅在用户输入的内容中允许 Emoji。
- ❌ 禁止使用 SVG 路径直接嵌入 HTML (除非特殊情况且经过审核)，应优先使用 Remix Icon 类名。
- ❌ 禁止混用其他图标库 (如 FontAwesome, Material Icons)。

## 4. 新功能开发流程

1. 访问 [Remix Icon](https://remixicon.com/) 搜索合适的图标。
2. 优先选择语义明确的图标 (如 "Settings" -> `ri-settings-3-line`)。
3. 保持风格统一，优先使用线性图标 (`-line`)，选中态使用填充图标 (`-fill`)。
4. 在代码中使用 `<i>` 标签引入。

## 5. 代码审查检查点

- [ ] 是否引入了新的 Emoji？ -> **拒绝**
- [ ] 是否使用了非 Remix Icon 的图标？ -> **拒绝**
- [ ] 图标是否对齐且大小合适？
