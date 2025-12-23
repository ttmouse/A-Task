import { MarkdownRenderer } from '../../utils/markdown-renderer.js';

// AIDEV-NOTE: 侧边栏使用指南页面逻辑
// 负责加载和渲染 Markdown 文档

/**
 * 初始化侧边栏
 */
async function initSidePanel(): Promise<void> {
  console.log('[SidePanel] 初始化使用指南页面');

  const contentElement = document.getElementById('content');
  if (!contentElement) {
    console.error('[SidePanel] 找不到内容容器');
    return;
  }

  try {
    // 加载并渲染 Markdown 文档
    const html = await MarkdownRenderer.loadAndRender('markdown/guide.md');

    // 渲染到页面
    contentElement.innerHTML = html;

    console.log('[SidePanel] 使用指南加载成功');

    // 添加平滑滚动到锚点的功能
    setupSmoothScroll();

  } catch (error) {
    console.error('[SidePanel] 加载使用指南失败:', error);

    contentElement.innerHTML = `
      <div class="markdown-body">
        <h2>⚠️ 加载失败</h2>
        <p>无法加载使用指南文档。</p>
        <p>请检查网络连接或稍后重试。</p>
      </div>
    `;
  }
}

/**
 * 设置平滑滚动到锚点
 */
function setupSmoothScroll(): void {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();

      const href = anchor.getAttribute('href');
      if (!href) return;

      const targetId = href.substring(1);
      const targetElement = document.getElementById(targetId);

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', initSidePanel);
