// 默认配置
import type { PluginConfig } from './types';

export const DEFAULT_CONFIG: PluginConfig = {
  debug: false,
  owners: [],
  checkInterval: 5,
  updateMode: 'notify',
  notifyGroups: [],
  notifyUsers: [],
  enableSchedule: true,
  ignoredPlugins: [],
  autoUpdatePlugins: [],
  selectedRawMirror: '',
  selectedDownloadMirror: '',
};
