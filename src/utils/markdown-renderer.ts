// AIDEV-NOTE: 简化的 Markdown 渲染工具
// 支持基础的 Markdown 语法，满足使用指南文档的需求

export class MarkdownRenderer {
  /**
   * 渲染 Markdown 文本为 HTML
   * @param markdown Markdown 文本
   * @returns HTML 字符串
   */
  static render(markdown: string): string {
    let html = markdown;

    // 1. 转义 HTML 标签（安全性）
    html = this.escapeHtml(html);

    // 2. 代码块（必须先处理，避免内部语法被转换）
    html = this.renderCodeBlocks(html);

    // 3. 标题
    html = this.renderHeadings(html);

    // 4. 分隔线
    html = html.replace(/^---$/gm, '<hr>');

    // 5. 粗体
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 6. 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 7. 列表
    html = this.renderLists(html);

    // 8. 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // 9. 段落
    html = this.renderParagraphs(html);

    return `<div class="markdown-body">${html}</div>`;
  }

  /**
   * 转义 HTML 标签
   */
  private static escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * 渲染代码块
   */
  private static renderCodeBlocks(text: string): string {
    // 匹配 ```...```
    return text.replace(/```([\s\S]*?)```/g, (match, code) => {
      const trimmedCode = code.trim();
      // 使用特殊标记保护代码块
      return `__CODEBLOCK_START__<pre><code>${trimmedCode}</code></pre>__CODEBLOCK_END__`;
    });
  }

  /**
   * 渲染标题
   */
  private static renderHeadings(text: string): string {
    return text.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
      const level = hashes.length;
      return `<h${level}>${content.trim()}</h${level}>`;
    });
  }

  /**
   * 渲染列表
   */
  private static renderLists(text: string): string {
    // 无序列表
    let html = text.replace(/^- (.+)$/gm, '__UL_ITEM__<li>$1</li>');

    // 有序列表
    html = html.replace(/^\d+\.\s+(.+)$/gm, '__OL_ITEM__<li>$1</li>');

    // 包裹 ul
    html = html.replace(/(__UL_ITEM__<li>.*?<\/li>\n?)+/g, (match) => {
      const items = match.replace(/__UL_ITEM__/g, '');
      return `<ul>${items}</ul>`;
    });

    // 包裹 ol
    html = html.replace(/(__OL_ITEM__<li>.*?<\/li>\n?)+/g, (match) => {
      const items = match.replace(/__OL_ITEM__/g, '');
      return `<ol>${items}</ol>`;
    });

    return html;
  }

  /**
   * 渲染段落
   */
  private static renderParagraphs(text: string): string {
    // 将双换行分割的文本转换为段落
    const lines = text.split('\n');
    let inCodeBlock = false;
    let result: string[] = [];
    let paragraph: string[] = [];

    for (const line of lines) {
      // 检测代码块边界
      if (line.includes('__CODEBLOCK_START__')) {
        inCodeBlock = true;
      }
      if (line.includes('__CODEBLOCK_END__')) {
        inCodeBlock = false;
      }

      const trimmedLine = line.trim();

      // 跳过已处理的元素
      if (
        inCodeBlock ||
        trimmedLine.startsWith('<h') ||
        trimmedLine.startsWith('<ul') ||
        trimmedLine.startsWith('<ol') ||
        trimmedLine.startsWith('<hr') ||
        trimmedLine.startsWith('<pre') ||
        trimmedLine === ''
      ) {
        // 如果有累积的段落，先输出
        if (paragraph.length > 0) {
          result.push(`<p>${paragraph.join(' ')}</p>`);
          paragraph = [];
        }
        result.push(line);
      } else {
        // 累积段落内容
        paragraph.push(trimmedLine);
      }
    }

    // 处理最后的段落
    if (paragraph.length > 0) {
      result.push(`<p>${paragraph.join(' ')}</p>`);
    }

    // 移除代码块标记
    return result
      .join('\n')
      .replace(/__CODEBLOCK_START__/g, '')
      .replace(/__CODEBLOCK_END__/g, '');
  }

  /**
   * 从文件加载并渲染 Markdown
   * @param filePath 文件路径（相对于扩展根目录）
   * @returns Promise<HTML 字符串>
   */
  static async loadAndRender(filePath: string): Promise<string> {
    try {
      const url = chrome.runtime.getURL(filePath);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ${filePath}: ${response.statusText}`);
      }
      const markdown = await response.text();
      return this.render(markdown);
    } catch (error) {
      console.error('[MarkdownRenderer] 加载文件失败:', error);
      return `
        <div class="markdown-body">
          <h2>⚠️ 加载失败</h2>
          <p>无法加载使用指南文档。</p>
          <p>错误信息: ${error instanceof Error ? error.message : String(error)}</p>
        </div>
      `;
    }
  }
}
