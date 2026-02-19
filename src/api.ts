// WebUI API 路由
import { pluginState } from './state';
import { checkAllUpdates, checkSinglePlugin, installPlugin, getInstalledPlugins, pingRawMirrors, pingDownloadMirrors, GITHUB_RAW_MIRRORS, DOWNLOAD_MIRRORS, installFromGithub, checkGithubRelease } from './updater';
import { startScheduler, stopScheduler } from './scheduler';

export function registerApiRoutes (router: any): void {
  // 获取配置
  router.getNoAuth('/config', (_: any, res: any) => {
    res.json({
      success: true,
      config: pluginState.config,
      version: pluginState.version,
    });
  });

  // 保存配置
  router.postNoAuth('/config', (req: any, res: any) => {
    const body = req.body as Record<string, unknown>;
    if (body.checkInterval !== undefined) {
      const n = Number(body.checkInterval);
      if (n >= 1) pluginState.config.checkInterval = n;
    }
    if (body.updateMode !== undefined && ['auto', 'notify'].includes(String(body.updateMode))) {
      pluginState.config.updateMode = String(body.updateMode) as 'auto' | 'notify';
    }
    if (body.enableSchedule !== undefined) pluginState.config.enableSchedule = Boolean(body.enableSchedule);
    if (body.debug !== undefined) pluginState.config.debug = Boolean(body.debug);
    if (body.owners !== undefined && Array.isArray(body.owners)) {
      pluginState.config.owners = (body.owners as string[]).map(String).filter(s => s.trim());
    }
    if (body.notifyGroups !== undefined && Array.isArray(body.notifyGroups)) {
      pluginState.config.notifyGroups = (body.notifyGroups as string[]).map(String).filter(s => s.trim());
    }
    if (body.notifyUsers !== undefined && Array.isArray(body.notifyUsers)) {
      pluginState.config.notifyUsers = (body.notifyUsers as string[]).map(String).filter(s => s.trim());
    }
    if (body.ignoredPlugins !== undefined && Array.isArray(body.ignoredPlugins)) {
      pluginState.config.ignoredPlugins = (body.ignoredPlugins as string[]).map(String).filter(s => s.trim());
    }
    if (body.autoUpdatePlugins !== undefined && Array.isArray(body.autoUpdatePlugins)) {
      pluginState.config.autoUpdatePlugins = (body.autoUpdatePlugins as string[]).map(String).filter(s => s.trim());
    }
    if (body.selectedRawMirror !== undefined) pluginState.config.selectedRawMirror = String(body.selectedRawMirror);
    if (body.selectedDownloadMirror !== undefined) pluginState.config.selectedDownloadMirror = String(body.selectedDownloadMirror);
    pluginState.saveConfig();
    stopScheduler();
    startScheduler();
    res.json({ success: true });
  });

  // 获取已安装插件列表
  router.getNoAuth('/plugins', async (_: any, res: any) => {
    const plugins = await getInstalledPlugins();
    res.json({ success: true, data: plugins });
  });

  // 检查更新
  router.getNoAuth('/check', async (_: any, res: any) => {
    try {
      const updates = await checkAllUpdates();
      res.json({ success: true, data: updates, lastCheck: pluginState.lastCheckTime });
    } catch (e) {
      res.json({ success: false, error: String(e) });
    }
  });

  // 检查单个插件更新
  router.getNoAuth('/check/:pluginName', async (req: any, res: any) => {
    try {
      const { pluginName } = req.params as { pluginName: string; };
      const update = await checkSinglePlugin(pluginName);
      res.json({ success: true, data: update, lastCheck: pluginState.lastCheckTime });
    } catch (e) {
      res.json({ success: false, error: String(e) });
    }
  });

  // 获取上次检查结果
  router.getNoAuth('/updates', (_: any, res: any) => {
    res.json({
      success: true,
      data: pluginState.availableUpdates,
      lastCheck: pluginState.lastCheckTime,
    });
  });

  // 执行更新（单个或全部）
  router.postNoAuth('/update', async (req: any, res: any) => {
    const { pluginName } = req.body as { pluginName?: string; };
    try {
      if (pluginName === '__all__') {
        const results: { name: string; success: boolean; }[] = [];
        for (const update of [...pluginState.availableUpdates]) {
          const ok = await installPlugin(update);
          results.push({ name: update.displayName, success: ok });
        }
        res.json({ success: true, data: results });
      } else {
        const update = pluginState.availableUpdates.find(u => u.pluginName === pluginName);
        if (!update) {
          res.json({ success: false, error: '未找到该插件的可用更新' });
          return;
        }
        const ok = await installPlugin(update);
        res.json({ success: ok, error: ok ? undefined : '更新失败，请查看日志' });
      }
    } catch (e) {
      res.json({ success: false, error: String(e) });
    }
  });

  // 获取群列表
  router.getNoAuth('/groups', async (_: any, res: any) => {
    try {
      if (!pluginState.actions || !pluginState.networkConfig) {
        res.json({ success: false, error: '插件未初始化' }); return;
      }
      const result = await pluginState.actions.call('get_group_list', {} as never, pluginState.adapterName, pluginState.networkConfig);
      res.json({ success: true, data: result || [] });
    } catch (e) { res.json({ success: false, error: String(e) }); }
  });

  // 日志
  router.getNoAuth('/logs', (_: any, res: any) => {
    res.json({ success: true, data: pluginState.logBuffer });
  });

  router.postNoAuth('/logs/clear', (_: any, res: any) => {
    pluginState.clearLogs();
    res.json({ success: true });
  });

  // ===== 镜像管理 =====

  // 获取镜像列表和当前选择
  router.getNoAuth('/mirrors', (_: any, res: any) => {
    res.json({
      success: true,
      raw: GITHUB_RAW_MIRRORS,
      download: DOWNLOAD_MIRRORS,
      selectedRaw: pluginState.config.selectedRawMirror,
      selectedDownload: pluginState.config.selectedDownloadMirror,
    });
  });

  // Ping Raw 镜像
  router.getNoAuth('/mirrors/ping/raw', async (_: any, res: any) => {
    try {
      const results = await pingRawMirrors();
      res.json({ success: true, data: results });
    } catch (e) {
      res.json({ success: false, error: String(e) });
    }
  });

  // Ping 下载镜像
  router.getNoAuth('/mirrors/ping/download', async (_: any, res: any) => {
    try {
      const results = await pingDownloadMirrors();
      res.json({ success: true, data: results });
    } catch (e) {
      res.json({ success: false, error: String(e) });
    }
  });

  // 选择镜像
  router.postNoAuth('/mirrors/select', (req: any, res: any) => {
    const { type, mirror } = req.body as { type?: string; mirror?: string; };
    if (type === 'raw') {
      pluginState.config.selectedRawMirror = mirror || '';
    } else if (type === 'download') {
      pluginState.config.selectedDownloadMirror = mirror || '';
    } else {
      res.json({ success: false, error: '无效的 type' }); return;
    }
    pluginState.saveConfig();
    pluginState.log('info', `镜像已切换: ${type} → ${mirror || '自动'}`);
    res.json({ success: true });
  });

  // ===== GitHub 插件安装 =====

  // 检查 GitHub 仓库最新版本
  router.getNoAuth('/github/check/:owner/:repo', async (req: any, res: any) => {
    const { owner, repo } = req.params as { owner: string; repo: string; };
    try {
      const info = await checkGithubRelease(`${owner}/${repo}`);
      // 确保已扫描插件列表
      if (pluginState.installedPlugins.length === 0) await getInstalledPlugins();
      const installed = pluginState.installedPlugins.find(p => p.name === repo);
      res.json({
        success: true,
        data: info,
        installed: installed ? { version: installed.currentVersion, status: installed.status } : null,
      });
    } catch (e) {
      res.json({ success: false, error: String(e) });
    }
  });

  // 从 GitHub 安装插件
  router.postNoAuth('/github/install', async (req: any, res: any) => {
    const { repo } = req.body as { repo?: string; };
    if (!repo) { res.json({ success: false, error: '缺少 repo 参数' }); return; }
    try {
      const result = await installFromGithub(repo);
      res.json(result);
    } catch (e) {
      res.json({ success: false, error: String(e) });
    }
  });
}
