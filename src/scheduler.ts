// 定时检查 & 通知推送
import { pluginState } from './state';
import { checkAllUpdates, installPlugin } from './updater';
import type { UpdateInfo } from './types';

/** 发送消息到群 */
async function sendGroupMsg (groupId: string, text: string): Promise<void> {
  if (!pluginState.actions || !pluginState.networkConfig) return;
  const msg: unknown[] = [{ type: 'text', data: { text } }];
  await pluginState.actions.call('send_group_msg', { group_id: Number(groupId), message: msg } as never, pluginState.adapterName, pluginState.networkConfig).catch(() => { });
}

/** 发送私聊消息 */
async function sendPrivateMsg (userId: string, text: string): Promise<void> {
  if (!pluginState.actions || !pluginState.networkConfig) return;
  const msg: unknown[] = [{ type: 'text', data: { text } }];
  await pluginState.actions.call('send_private_msg', { user_id: Number(userId), message: msg } as never, pluginState.adapterName, pluginState.networkConfig).catch(() => { });
}

/** 构建更新通知文本 */
function buildNotifyText (updates: UpdateInfo[]): string {
  const lines: string[] = ['🔄 插件更新提醒', ''];
  for (const u of updates) {
    lines.push(`📦 ${u.displayName}`);
    lines.push(`   ${u.currentVersion} → ${u.latestVersion}`);
    if (u.publishedAt) {
      lines.push(`   发布于 ${new Date(u.publishedAt).toLocaleString('zh-CN')}`);
    }
    if (u.changelog) {
      const short = u.changelog.split('\n').slice(0, 3).join('\n   ');
      lines.push(`   ${short}`);
    }
    lines.push('');
  }
  if (pluginState.config.updateMode === 'notify') {
    lines.push('发送 "更新 全部" 执行更新');
    lines.push('发送 "更新 <插件名>" 更新指定插件');
  }
  return lines.join('\n');
}

/** 推送更新通知 */
async function pushNotification (updates: UpdateInfo[]): Promise<void> {
  if (updates.length === 0) return;
  const text = buildNotifyText(updates);

  // 通知群
  for (const gid of pluginState.config.notifyGroups) {
    await sendGroupMsg(gid, text);
  }

  // 通知私聊
  for (const uid of pluginState.config.notifyUsers) {
    await sendPrivateMsg(uid, text);
  }
}

/** 执行一次检查（定时任务调用） */
export async function runScheduledCheck (): Promise<void> {
  pluginState.log('info', '定时检查开始...');
  const updates = await checkAllUpdates();

  if (updates.length === 0) return;

  // 过滤掉已通知过的更新（同一插件同一版本只通知一次）
  const newUpdates = updates.filter(u => {
    const key = `${u.pluginName}@${u.latestVersion}`;
    return !pluginState.notifiedUpdates.has(key);
  });

  // 标记为已通知
  const markNotified = (list: UpdateInfo[]) => {
    for (const u of list) {
      pluginState.notifiedUpdates.add(`${u.pluginName}@${u.latestVersion}`);
    }
  };

  if (pluginState.config.updateMode === 'auto') {
    // 自动更新模式：仅更新 autoUpdatePlugins 列表中的插件（空列表=全部）
    const autoList = new Set(pluginState.config.autoUpdatePlugins);
    const toUpdate = autoList.size > 0
      ? updates.filter(u => autoList.has(u.pluginName))
      : updates;
    if (toUpdate.length === 0) {
      // 有更新但不在自动更新列表中，仅通知（未通知过的）
      if (newUpdates.length > 0) {
        await pushNotification(newUpdates);
        markNotified(newUpdates);
      }
      return;
    }
    const results: string[] = [];
    for (const update of toUpdate) {
      const ok = await installPlugin(update);
      results.push(`${update.displayName}: ${ok ? '✅ 成功' : '❌ 失败'}`);
      // 更新成功后从已通知集合中移除（下次新版本会重新通知）
      if (ok) pluginState.notifiedUpdates.delete(`${update.pluginName}@${update.latestVersion}`);
    }
    // 通知更新结果
    const text = ['🔄 插件自动更新完成', '', ...results].join('\n');
    for (const gid of pluginState.config.notifyGroups) {
      await sendGroupMsg(gid, text);
    }
    for (const uid of pluginState.config.notifyUsers) {
      await sendPrivateMsg(uid, text);
    }
    // 如果还有不在自动更新列表中的更新，也通知（未通知过的）
    const remaining = newUpdates.filter(u => !autoList.has(u.pluginName) && autoList.size > 0);
    if (remaining.length > 0) {
      await pushNotification(remaining);
      markNotified(remaining);
    }
  } else {
    // 仅通知模式：只推送未通知过的
    if (newUpdates.length > 0) {
      await pushNotification(newUpdates);
      markNotified(newUpdates);
    }
  }
}

/** 启动定时检查 */
export function startScheduler (): void {
  stopScheduler();
  if (!pluginState.config.enableSchedule) {
    pluginState.debug('定时检查已禁用');
    return;
  }
  const intervalMs = Math.max(pluginState.config.checkInterval, 1) * 60 * 1000;
  pluginState.checkTimer = setInterval(() => {
    runScheduledCheck().catch(e => pluginState.log('error', '定时检查异常: ' + e));
  }, intervalMs);
  pluginState.log('info', `定时检查已启动，间隔 ${pluginState.config.checkInterval} 分钟`);

  // 启动后延迟 30 秒执行首次检查
  setTimeout(() => {
    runScheduledCheck().catch(e => pluginState.log('error', '首次检查异常: ' + e));
  }, 30000);
}

/** 停止定时检查 */
export function stopScheduler (): void {
  if (pluginState.checkTimer) {
    clearInterval(pluginState.checkTimer);
    pluginState.checkTimer = null;
  }
}
