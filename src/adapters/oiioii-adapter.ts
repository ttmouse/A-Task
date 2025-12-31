// [IN]: DOM (OIIOII), BaseAdapter
// [OUT]: DOM Manipulation (Input/Submit), Status Monitoring
// [POS]: Adapters Layer / Concrete Implementation (OIIOII)
// Protocol: When updated, sync this header + src/adapters/.folder.md

import { BaseAdapter } from './base-adapter.js';
import { TaskStatus } from '../types/task.js';

type InputState = 'unknown' | 'idle' | 'ready' | 'waiting' | 'busy' | 'error' | 'blocked';

// AIDEV-NOTE: OIIOII 适配器实现
// 基于 oiioii.html 分析的 DOM 结构

export class OiioiiAdapter extends BaseAdapter {
    // AIDEV-NOTE: 根据 oiioii.html 页面结构确定的选择器
    private static readonly SELECTORS = {
        // 输入框选择器 - Slate.js contenteditable
        inputBox: '[role="textbox"][contenteditable="true"], ._slate-area-editable_134k3_158',
        // 发送按钮选择器
        submitButton: 'button._send-button_134k3_221, ._send-button_134k3_221',
        // 暂停/停止按钮选择器 (生成过程中)
        stopButton: 'button.pause-button, .pause-button',
        // 生成状态容器 - 存在时表示正在生成
        generatingContainer: '.pause-layout, .pause-container',
        // 工作中指示器
        thinkingIndicator: '._think-node_1rfb3_1',
        // 输入框布局容器
        inputLayout: '._layout_134k3_20, ._mind-input_134k3_2'
    };

    // 存储监控相关变量
    private monitoringInterval: number | null = null;
    private mutationObserver: MutationObserver | null = null;
    private hasSeenBusyState = false;
    private currentInputState: InputState = 'unknown';
    private lastInputDetail?: string;

    /**
     * AIDEV-NOTE: 提交内容到 OIIOII（支持多步骤任务）
     * @param content 要提交的内容（当前步骤内容或完整 prompt）
     */
    async submitContent(content: string): Promise<boolean> {
        try {
            this.sendDebugLog('info', '🔍 检查 OIIOII 页面是否空闲...');
            this.notifyInputStatus('waiting', '等待页面空闲');

            const isIdle = await this.waitForPageIdle();
            if (!isIdle) {
                this.sendDebugLog('error', '❌ 页面一直处于生成状态，暂时无法提交新任务');
                this.notifyInputStatus('blocked', '页面仍在生成，暂无法输入');
                return false;
            }

            this.sendDebugLog('success', '✅ 页面空闲，开始准备提交任务');
            this.notifyInputStatus('ready', '页面空闲，准备输入内容');

            // 查找输入框
            this.sendDebugLog('info', '🔍 正在查找 OIIOII 输入框...');
            const inputBox = document.querySelector(OiioiiAdapter.SELECTORS.inputBox) as HTMLElement;
            if (!inputBox) {
                this.sendDebugLog('error', '❌ 找不到输入框，请检查选择器');
                this.notifyInputStatus('error', '找不到输入框');
                throw new Error('找不到 OIIOII 输入框');
            }
            this.sendDebugLog('success', '✅ 输入框定位成功');

            // 激活输入框 - 使用 focus + Selection API
            this.sendDebugLog('info', '🎯 正在激活输入框...');
            this.activateInputWithSelection(inputBox);
            await this.sleep(100);

            // 使用 insertText 输入内容
            this.sendDebugLog('info', '📝 正在输入内容...');
            const inputSuccess = this.typeContent(inputBox, content);

            if (inputSuccess) {
                this.sendDebugLog('success', `✅ 内容已输入 (${content.length} 字符)`);
            } else {
                this.sendDebugLog('warning', '⚠️ insertText 失败，尝试剪贴板方式');
                // 回退到剪贴板方式
                await navigator.clipboard.writeText(content);
                this.sendDebugLog('info', '📋 内容已复制到剪贴板，请手动粘贴');
                this.notifyInputStatus('ready', '请按 Cmd+V 粘贴后发送');
                this.startMonitoring();
                return true;
            }

            // 等待 Slate.js 处理输入
            await this.sleep(300);

            // 检查发送按钮状态
            const submitButton = document.querySelector(OiioiiAdapter.SELECTORS.submitButton) as HTMLButtonElement;
            if (submitButton && !submitButton.disabled) {
                this.sendDebugLog('info', '🚀 发送按钮已启用，自动点击...');
                submitButton.click();
                this.sendDebugLog('success', '✅ 已自动发送');
                this.notifyInputStatus('busy', '任务已提交，等待 OIIOII 响应');
            } else {
                this.sendDebugLog('warning', '⚠️ 发送按钮未启用，请手动发送');
                this.notifyInputStatus('ready', '内容已输入，请手动发送');
            }

            // 开始监控回复完成
            this.startMonitoring();

            return true;

        } catch (error) {
            console.error('[OIIOII Adapter] 提交内容失败:', error);
            return false;
        }
    }

    /**
     * 清空输入框
     */
    private clearInputBox(inputBox: HTMLElement): void {
        // 对于 Slate.js contenteditable，需要清空内容
        inputBox.innerHTML = '';
        // 尝试选中所有内容并删除
        const selection = window.getSelection();
        if (selection) {
            const range = document.createRange();
            range.selectNodeContents(inputBox);
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('delete', false);
        }
    }

    /**
     * 填充输入框内容 - 最简化版本
     * AIDEV-NOTE: 只设置 DOM 结构，完全不触发任何事件
     */
    private fillInputBoxSimple(inputBox: HTMLElement, content: string): void {
        // 清空并创建 Slate.js DOM 结构
        inputBox.innerHTML = '';

        const outerSpan = document.createElement('span');
        outerSpan.className = '_slate-area-editable-span_1a694_16';

        const textNodeSpan = document.createElement('span');
        textNodeSpan.setAttribute('data-slate-node', 'text');

        const leafSpan = document.createElement('span');
        leafSpan.setAttribute('data-slate-leaf', 'true');

        const stringSpan = document.createElement('span');
        stringSpan.setAttribute('data-slate-string', 'true');
        stringSpan.textContent = content;

        leafSpan.appendChild(stringSpan);
        textNodeSpan.appendChild(leafSpan);
        outerSpan.appendChild(textNodeSpan);
        inputBox.appendChild(outerSpan);

        // 完全不触发任何事件，避免页面刷新
    }

    /**
     * 激活输入框并设置光标 - 使用 focus + Selection API
     * AIDEV-NOTE: 这是经过浏览器测试验证的方法
     */
    private activateInputWithSelection(target: HTMLElement): void {
        // 聚焦
        target.focus();

        // 设置光标到末尾（关键步骤！）
        const selection = window.getSelection();
        if (selection) {
            const range = document.createRange();
            range.selectNodeContents(target);
            range.collapse(false); // 折叠到末尾
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }

    /**
     * 使用 insertText 向输入框输入内容
     * AIDEV-NOTE: 模拟键盘输入，让 Slate.js 正确处理
     */
    private typeContent(target: HTMLElement, content: string): boolean {
        try {
            // 确保输入框聚焦
            target.focus();

            // 使用 execCommand insertText
            // 这会触发 Slate.js 的输入处理逻辑
            const success = document.execCommand('insertText', false, content);

            if (!success) {
                // 回退：尝试使用 InputEvent
                const inputEvent = new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: content
                });
                target.dispatchEvent(inputEvent);
            }

            return true;
        } catch (error) {
            console.warn('[OIIOII Adapter] typeContent 失败:', error);
            return false;
        }
    }

    /**
     * 检查内容是否出现在输入框中
     */
    private didContentAppear(target: HTMLElement, expected: string): boolean {
        const actual = target.textContent || '';
        return actual.substring(0, 20) === expected.substring(0, 20);
    }





    /**
     * 发送调试日志
     */
    private sendDebugLog(level: 'info' | 'success' | 'warning' | 'error', message: string): void {
        try {
            chrome.runtime.sendMessage({
                type: 'DEBUG_LOG',
                level,
                message
            });
        } catch (e) {
            console.error('[OIIOII Adapter] 发送日志失败:', e);
        }
    }

    /**
     * 发送输入状态通知
     */
    private notifyInputStatus(state: InputState, detail?: string): void {
        const normalizedDetail = detail || '';
        if (this.currentInputState === state && normalizedDetail === (this.lastInputDetail || '')) {
            return;
        }
        this.currentInputState = state;
        this.lastInputDetail = normalizedDetail || undefined;

        try {
            chrome.runtime.sendMessage({
                type: 'INPUT_STATUS_UPDATE',
                state,
                detail,
                timestamp: Date.now()
            });
        } catch (e) {
            // 忽略发送失败
        }
    }

    /**
     * 检查任务状态
     * AIDEV-NOTE: OIIOII 通过检测 .pause-layout 容器来判断是否在生成中
     * 这个容器只在生成过程中存在于 DOM
     */
    async checkStatus(): Promise<TaskStatus> {
        try {
            // 使用统一的繁忙状态检测
            const busyState = this.detectPageBusyState();

            if (busyState.busy) {
                this.sendDebugLog('info', `⏳ ${busyState.detail}`);
                this.hasSeenBusyState = true;
                return TaskStatus.RUNNING;
            }

            // 如果之前进入过生成状态，现在没有生成指示器了，说明完成
            if (this.hasSeenBusyState) {
                this.sendDebugLog('success', '🎉 生成状态指示器消失，任务已完成');
                this.stopMonitoring();
                this.notifyInputStatus('idle', '任务完成，页面空闲');
                return TaskStatus.COMPLETED;
            }

            // 还没进入过生成状态，可能刚提交还没开始
            this.sendDebugLog('info', '⏳ 等待 OIIOII 开始生成...');
            return TaskStatus.RUNNING;

        } catch (error) {
            console.error('[OIIOII Adapter] 检查状态失败:', error);
            return TaskStatus.FAILED;
        }
    }

    /**
     * 开始监控任务完成
     */
    private startMonitoring(): void {
        console.log('[OIIOII Adapter] 开始监控回复完成');
        this.hasSeenBusyState = false;

        // 查找可以观察的容器
        const inputLayout = document.querySelector(OiioiiAdapter.SELECTORS.inputLayout);
        if (!inputLayout) {
            this.sendDebugLog('warning', '⚠️ 找不到输入布局容器，使用轮询方式监控');
            return;
        }

        // 创建 MutationObserver 监听 DOM 变化
        this.mutationObserver = new MutationObserver(() => {
            // 有变化发生，触发状态检查
            this.sendDebugLog('info', '🔄 检测到页面状态变化...');
        });

        // 观察整个 body 以捕获生成状态的变化
        this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'disabled']
        });

        this.sendDebugLog('success', '✅ 已启动 DOM 变化监听');
    }

    /**
     * 停止监控
     */
    private stopMonitoring(): void {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }

        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
            this.sendDebugLog('info', '🛑 已停止 DOM 变化监听');
        }

        this.hasSeenBusyState = false;
        console.log('[OIIOII Adapter] 停止监控');
    }

    /**
     * 检测页面是否仍在生成
     * AIDEV-NOTE: 简化逻辑 - 只检查 .pause-layout 容器
     * 根据 oiioii.html 分析，这个容器只在生成过程中才存在于 DOM
     */
    private detectPageBusyState(): { busy: boolean; detail?: string } {
        // 主要检测：.pause-layout 容器是否存在于 DOM 中
        // 这个容器包含整个生成状态 UI（工作中...指示器 + 暂停按钮）
        const pauseLayout = document.querySelector('.pause-layout');

        if (pauseLayout) {
            // 检查是否可见（宽高大于0）
            const rect = pauseLayout.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return {
                    busy: true,
                    detail: '检测到生成状态容器 (.pause-layout)，OIIOII 正在工作中'
                };
            }
        }

        // 备用检测：检查暂停按钮
        const stopButton = document.querySelector('button.pause-button');
        if (stopButton) {
            const rect = stopButton.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return {
                    busy: true,
                    detail: '检测到暂停按钮，正在生成中'
                };
            }
        }

        return { busy: false };
    }

    /**
     * 检查元素是否可见
     */
    private isElementVisible(element: Element | null): boolean {
        if (!element) return false;
        const el = element as HTMLElement;
        const styles = window.getComputedStyle(el);
        if (styles.display === 'none' || styles.visibility === 'hidden' || styles.opacity === '0') {
            return false;
        }
        if (el.offsetParent === null && styles.position !== 'fixed') {
            return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    /**
     * 等待页面空闲
     */
    private async waitForPageIdle(timeout = 60000, interval = 1000): Promise<boolean> {
        const startTime = Date.now();
        let lastLogTime = 0;

        while (Date.now() - startTime < timeout) {
            const state = this.detectPageBusyState();
            if (!state.busy) {
                this.notifyInputStatus('ready', '页面空闲，准备输入');
                return true;
            }

            this.notifyInputStatus('waiting', state.detail || '等待页面空闲');
            if (Date.now() - lastLogTime > 4000) {
                this.sendDebugLog('info', state.detail ? `⏳ ${state.detail}` : '⏳ OIIOII 仍在生成，等待空闲...');
                lastLogTime = Date.now();
            }

            await this.sleep(interval);
        }

        this.notifyInputStatus('blocked', '页面长时间繁忙，提交取消');
        return false;
    }

    /**
     * 获取生成结果
     * AIDEV-NOTE: OIIOII 主要用于图片生成，暂时返回空结果
     */
    async getResult(): Promise<any> {
        // OIIOII 是图片生成平台，结果会显示在页面上
        // 暂时不需要提取具体结果
        return {
            text: '',
            html: ''
        };
    }

    /**
     * 清理和重置（为多步骤任务做准备）
     */
    async cleanup(): Promise<void> {
        // 停止所有监控
        this.stopMonitoring();

        // 清空输入框
        try {
            const inputBox = document.querySelector(OiioiiAdapter.SELECTORS.inputBox) as HTMLElement;
            if (inputBox) {
                this.clearInputBox(inputBox);
                this.sendDebugLog('info', '🧹 输入框已清空');
            }
        } catch (error) {
            console.warn('[OIIOII Adapter] 清空输入框失败:', error);
        }

        // 等待页面状态稳定
        await this.sleep(500);

        console.log('[OIIOII Adapter] 清理完成，准备执行下一步');
        this.notifyInputStatus('idle', '输入已重置');
    }

    /**
     * 辅助方法：延迟
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
