// INPUT: ../types/task.js (Task, SiteType), ./base-adapter.js, ./gemini-adapter.js, ./chatgpt-adapter.js
// OUTPUT: AdapterFactory 类，提供 create() 方法根据站点类型创建适配器实例
// POS: 适配器层工厂类，被 TaskExecutor 和其他需要创建适配器的模块调用
// 一旦本文件被修改，请更新此注释并同步更新 /src/adapters/README.md

import { Task, SiteType } from '../types/task.js';
import { BaseAdapter } from './base-adapter.js';
import { GeminiAdapter } from './gemini-adapter.js';
import { ChatGPTAdapter } from './chatgpt-adapter.js';

// AIDEV-NOTE: 适配器工厂
// 根据网站类型创建对应的适配器实例

export class AdapterFactory {
  /**
   * 创建适配器
   * @param task 任务对象
   * @returns 对应网站的适配器实例
   */
  static create(siteType: SiteType, task: Task): BaseAdapter {
    switch (siteType) {
      case SiteType.GEMINI:
        return new GeminiAdapter(task);

      case SiteType.CHATGPT:
        return new ChatGPTAdapter(task);

      default:
        throw new Error(`不支持的网站类型: ${siteType}`);
    }
  }

  /**
   * 检查是否支持指定的网站类型
   * @param siteType 网站类型
   * @returns 是否支持
   */
  static isSupported(siteType: SiteType): boolean {
    return [SiteType.GEMINI, SiteType.CHATGPT].includes(siteType);
  }

  /**
   * 获取所有支持的网站类型
   * @returns 支持的网站类型列表
   */
  static getSupportedSites(): SiteType[] {
    return [SiteType.GEMINI, SiteType.CHATGPT];
  }
}
