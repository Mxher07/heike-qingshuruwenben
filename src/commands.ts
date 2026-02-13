// 指令处理
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import { pluginState } from './state';
import { checkAllUpdates, installPlugin, getInstalledPlugins } from './updater';
import { startScheduler, stopScheduler } from './scheduler';

function isOwner (userId: string): boolean {
  const owners = pluginState.config.owners || [];
  return owners.length === 0 || owners.includes(String(userId));
}

async function sendReply (event: OB11Message, text: string, ctx: NapCatPluginContext): Promise<void> {
  const msg: unknown[] = [{ type: 'text', data: { text } }];
  if (event.message_type === 'group') {
    await ctx.actions.call('send_group_msg', { group_id: event.group_id, message: msg } as never, ctx.adapterName, ctx.pluginManager.config).catch(() => { });
  } else {
    await ctx.actions.call('send_private_msg', { user_id: event.user_id, message: msg } as never, ctx.adapterName, ctx.pluginManager.config).catch(() => { });
  }
}

export async function handleCommand (event: OB11Message, cmd: string, ctx: NapCatPluginContext): Promise<boolean> {
  // 更新帮助
  if (cmd === '帮助' || cmd === '') {
    const lines = [
      '🔄 插件自动更新',
      '',
      '更新 检查 - 检查更新',
      '更新 列表 - 已安装插件',
      '更新 状态 - 检查结果',
      '更新 全部 - 更新全部',
      '更新 <编号|插件名> - 更新指定插件',
      '更新 模式 <auto|notify> - 切换模式',
      '更新 间隔 <分钟> - 检查间隔',
      '更新 忽略/取消忽略 <插件名>',
      '',
      '更多配置请前往 WebUI',
    ];
    await sendReply(event, lines.join('\n'), ctx);
    return true;
  }

  // 更新 检查
  if (cmd === '检查') {
    await sendReply(event, '🔍 正在检查插件更新...', ctx);
    const updates = await checkAllUpdates();
    if (updates.length === 0) {
      await sendReply(event, '✅ 所有插件均为最新版本', ctx);
    } else {
      const lines = ['📦 发现以下插件可更新：', ''];
      updates.forEach((u, i) => {
        lines.push(`${i + 1}. ${u.displayName}: ${u.currentVersion} → ${u.latestVersion}`);
      });
      lines.push('', '发送 "更新 全部" 或 "更新 <编号>" 执行更新');
      await sendReply(event, lines.join('\n'), ctx);
    }
    return true;
  }

  // 更新 列表
  if (cmd === '列表') {
    const plugins = await getInstalledPlugins();
    if (plugins.length === 0) {
      await sendReply(event, '未扫描到可管理的插件', ctx);
    } else {
      const ignored = new Set(pluginState.config.ignoredPlugins);
      const lines = [`📋 已安装插件 (${plugins.length})`, ''];
      plugins.forEach((p, i) => {
        const tag = ignored.has(p.name) ? ' [已忽略]' : '';
        lines.push(`${i + 1}. ${p.displayName} v${p.currentVersion} (${p.status})${tag}`);
      });
      await sendReply(event, lines.join('\n'), ctx);
    }
    return true;
  }

  // 更新 状态
  if (cmd === '状态') {
    const lines = ['🔄 自动更新状态', ''];
    lines.push(`模式: ${pluginState.config.updateMode === 'auto' ? '自动更新' : '仅通知'}`);
    lines.push(`定时检查: ${pluginState.config.enableSchedule ? '已启用' : '已禁用'}`);
    lines.push(`检查间隔: ${pluginState.config.checkInterval} 分钟`);
    lines.push(`上次检查: ${pluginState.lastCheckTime ? new Date(pluginState.lastCheckTime).toLocaleString('zh-CN') : '尚未检查'}`);
    lines.push(`可更新: ${pluginState.availableUpdates.length} 个`);
    if (pluginState.availableUpdates.length > 0) {
      pluginState.availableUpdates.forEach((u, i) => {
        lines.push(`  ${i + 1}. ${u.displayName}: ${u.currentVersion} → ${u.latestVersion}`);
      });
    }
    await sendReply(event, lines.join('\n'), ctx);
    return true;
  }

  // 以下指令需要主人权限
  if (!isOwner(String(event.user_id))) {
    await sendReply(event, '⚠️ 该操作需要主人权限', ctx);
    return true;
  }

  // 更新 全部
  if (cmd === '全部') {
    if (pluginState.availableUpdates.length === 0) {
      await sendReply(event, '没有可更新的插件，请先执行 "更新 检查"', ctx);
      return true;
    }
    await sendReply(event, `⏳ 正在更新 ${pluginState.availableUpdates.length} 个插件...`, ctx);
    const results: string[] = [];
    for (const update of [...pluginState.availableUpdates]) {
      const ok = await installPlugin(update);
      results.push(`${update.displayName}: ${ok ? '✅ 成功' : '❌ 失败'}`);
    }
    await sendReply(event, results.join('\n'), ctx);
    return true;
  }

  // 更新 模式 <auto|notify>
  if (cmd.startsWith('模式')) {
    const mode = cmd.replace('模式', '').trim();
    if (mode === 'auto' || mode === 'notify') {
      pluginState.config.updateMode = mode;
      pluginState.saveConfig();
      await sendReply(event, `✅ 更新模式已切换为: ${mode === 'auto' ? '自动更新' : '仅通知'}`, ctx);
    } else {
      await sendReply(event, '用法: 更新 模式 <auto|notify>', ctx);
    }
    return true;
  }

  // 更新 间隔 <分钟>
  if (cmd.startsWith('间隔')) {
    const n = parseInt(cmd.replace('间隔', '').trim());
    if (n >= 1) {
      pluginState.config.checkInterval = n;
      pluginState.saveConfig();
      stopScheduler();
      startScheduler();
      await sendReply(event, `✅ 检查间隔已设置为 ${n} 分钟`, ctx);
    } else {
      await sendReply(event, '间隔最小为 1 分钟', ctx);
    }
    return true;
  }

  // 更新 忽略 <插件名>
  if (cmd.startsWith('忽略 ')) {
    const name = cmd.replace('忽略 ', '').trim();
    if (!pluginState.config.ignoredPlugins.includes(name)) {
      pluginState.config.ignoredPlugins.push(name);
      pluginState.saveConfig();
    }
    await sendReply(event, `✅ 已忽略插件: ${name}`, ctx);
    return true;
  }

  // 更新 取消忽略 <插件名>
  if (cmd.startsWith('取消忽略 ')) {
    const name = cmd.replace('取消忽略 ', '').trim();
    pluginState.config.ignoredPlugins = pluginState.config.ignoredPlugins.filter(n => n !== name);
    pluginState.saveConfig();
    await sendReply(event, `✅ 已取消忽略: ${name}`, ctx);
    return true;
  }

  // 更新 <编号|插件名> — 更新指定插件
  const targetName = cmd.trim();
  if (targetName) {
    // 支持编号
    const num = parseInt(targetName);
    let update;
    if (!isNaN(num) && num >= 1 && num <= pluginState.availableUpdates.length) {
      update = pluginState.availableUpdates[num - 1];
    } else {
      update = pluginState.availableUpdates.find(
        u => u.pluginName === targetName || u.displayName === targetName
      );
    }
    if (!update) {
      await sendReply(event, `未找到 "${targetName}" 的可用更新，请先执行 "更新 检查"`, ctx);
      return true;
    }
    await sendReply(event, `⏳ 正在更新 ${update.displayName}...`, ctx);
    const ok = await installPlugin(update);
    await sendReply(event, ok
      ? `✅ ${update.displayName} 已更新到 v${update.latestVersion}`
      : `❌ ${update.displayName} 更新失败，请查看日志`, ctx);
    return true;
  }

  return false;
}
