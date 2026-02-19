// 插件全局状态
import type { ActionMap } from 'napcat-types/napcat-onebot/action/index';
import type { PluginLogger } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { PluginConfig, LogEntry, PluginInfo, UpdateInfo } from './types';
import { DEFAULT_CONFIG } from './config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

// 运行时从 package.json 读取版本号
function getPluginVersion (): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '1.0.0';
    }
  } catch { /* 读取失败使用默认版本 */ }
  return '1.0.0';
}

class PluginState {
  /** 插件版本（运行时从 package.json 读取） */
  version: string = getPluginVersion();
  logger: PluginLogger | null = null;
  actions: ActionMap | undefined;
  adapterName = '';
  networkConfig: NetworkAdapterConfig | null = null;
  pluginManager: any = null;
  config: PluginConfig = { ...DEFAULT_CONFIG };
  configPath = '';
  logBuffer: LogEntry[] = [];
  /** 已扫描到的插件列表 */
  installedPlugins: PluginInfo[] = [];
  /** 上次检查到的可更新列表 */
  availableUpdates: UpdateInfo[] = [];
  /** 上次检查时间 */
  lastCheckTime = 0;
  /** 已通知过的更新（pluginName@version），避免重复推送 */
  notifiedUpdates: Set<string> = new Set();
  /** 定时器 */
  checkTimer: ReturnType<typeof setInterval> | null = null;

  private readonly maxLogEntries = 300;

  log (level: 'info' | 'warn' | 'error', msg: string): void {
    const tag = `[AutoUpdate] ${msg}`;
    this.logger?.[level](tag);
    console.log(`[${level.toUpperCase()}] ${tag}`);
    this.logBuffer.push({ time: Date.now(), level, msg });
    if (this.logBuffer.length > this.maxLogEntries) this.logBuffer.splice(0, this.logBuffer.length - this.maxLogEntries);
  }

  debug (msg: string): void {
    if (this.config.debug) {
      this.logBuffer.push({ time: Date.now(), level: 'debug', msg });
    }
  }

  saveConfig (): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      this.debug('配置已保存');
    } catch (e) {
      this.log('error', '保存配置失败: ' + e);
    }
  }

  clearLogs (): void {
    this.logBuffer = [];
  }
}

export const pluginState = new PluginState();
