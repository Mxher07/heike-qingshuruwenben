// 插件自动更新 类型定义

export type UpdateMode = 'notify' | 'auto';

export interface PluginConfig {
  /** 调试模式 */
  debug: boolean;
  /** 主人QQ号列表 */
  owners: string[];
  /** 检查间隔（分钟） */
  checkInterval: number;
  /** 更新模式: notify=仅通知, auto=自动更新 */
  updateMode: UpdateMode;
  /** 通知推送的群列表 */
  notifyGroups: string[];
  /** 通知推送的私聊QQ列表 */
  notifyUsers: string[];
  /** 是否启用定时检查 */
  enableSchedule: boolean;
  /** 忽略更新的插件列表 */
  ignoredPlugins: string[];
  /** 自动更新的插件列表（空=全部自动更新） */
  autoUpdatePlugins: string[];
  /** 用户选择的 Raw 镜像（空字符串=自动） */
  selectedRawMirror: string;
  /** 用户选择的下载镜像（空字符串=自动） */
  selectedDownloadMirror: string;
}

export interface MirrorPingResult {
  url: string;
  label: string;
  latency: number;
  ok: boolean;
}

export interface PluginInfo {
  /** 插件包名（与商店索引 id 一致，来自 packageJson.name） */
  name: string;
  /** NapCat 内部 id（用于调用 pluginManager API） */
  internalId: string;
  /** 插件显示名 */
  displayName: string;
  /** 当前版本 */
  currentVersion: string;
  /** 插件状态 */
  status: string;
  /** 主页链接 */
  homepage: string;
}

export interface UpdateInfo {
  /** 插件包名 */
  pluginName: string;
  /** 插件显示名 */
  displayName: string;
  /** 当前版本 */
  currentVersion: string;
  /** 最新版本 */
  latestVersion: string;
  /** 下载地址 */
  downloadUrl: string;
  /** 更新日志 */
  changelog: string;
  /** 发布时间 */
  publishedAt: string;
}

export interface LogEntry {
  time: number;
  level: string;
  msg: string;
}
