// 核心更新逻辑：通过 pluginManager 获取已安装插件，通过商店索引检查更新
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { PluginInfo, UpdateInfo, MirrorPingResult } from './types';
import { pluginState } from './state';

// 插件商店索引源（与 NapCat 后端 PluginStore.ts 完全一致）
const PLUGIN_STORE_SOURCES = [
  'https://raw.githubusercontent.com/NapNeko/napcat-plugin-index/main/plugins.v4.json',
];

// GitHub Raw 镜像（与 NapCat napcat-common/src/mirror.ts GITHUB_RAW_MIRRORS 完全一致）
export const GITHUB_RAW_MIRRORS = [
  'https://raw.githubusercontent.com',
  'https://github.chenc.dev/https://raw.githubusercontent.com',
  'https://ghproxy.cfd/https://raw.githubusercontent.com',
  'https://ghproxy.cc/https://raw.githubusercontent.com',
  'https://gh-proxy.net/https://raw.githubusercontent.com',
];

// GitHub 文件加速镜像（与 NapCat napcat-common/src/mirror.ts GITHUB_FILE_MIRRORS 完全一致）
export const DOWNLOAD_MIRRORS = [
  'https://github.chenc.dev/',
  'https://ghproxy.cfd/',
  'https://github.tbedu.top/',
  'https://ghproxy.cc/',
  'https://gh.monlor.com/',
  'https://cdn.akaere.online/',
  'https://gh.idayer.com/',
  'https://gh.llkk.cc/',
  'https://ghpxy.hwinzniej.top/',
  'https://github-proxy.memory-echoes.cn/',
  'https://git.yylx.win/',
  'https://gitproxy.mrhjx.cn/',
  'https://gh.fhjhy.top/',
  'https://gp.zkitefly.eu.org/',
  'https://gh-proxy.com/',
  'https://ghfile.geekertao.top/',
  'https://j.1lin.dpdns.org/',
  'https://ghproxy.imciel.com/',
  'https://github-proxy.teach-english.tech/',
  'https://gh.927223.xyz/',
  'https://github.ednovas.xyz/',
  'https://ghf.xn--eqrr82bzpe.top/',
  'https://gh.dpik.top/',
  'https://gh.jasonzeng.dev/',
  'https://gh.xxooo.cf/',
  'https://gh.bugdey.us.kg/',
  'https://ghm.078465.xyz/',
  'https://j.1win.ggff.net/',
  'https://tvv.tw/',
  'https://gitproxy.127731.xyz/',
  'https://gh.inkchills.cn/',
  'https://ghproxy.cxkpro.top/',
  'https://gh.sixyin.com/',
  'https://github.geekery.cn/',
  'https://git.669966.xyz/',
  'https://gh.5050net.cn/',
  'https://gh.felicity.ac.cn/',
  'https://github.dpik.top/',
  'https://ghp.keleyaa.com/',
  'https://gh.wsmdn.dpdns.org/',
  'https://ghproxy.monkeyray.net/',
  'https://fastgit.cc/',
  'https://gh.catmak.name/',
  'https://gh.noki.icu/',
  '', // 直连（无镜像）
];

interface StorePlugin {
  id: string;
  name: string;
  version: string;
  downloadUrl: string;
  description?: string;
  author?: string;
}

/** 比较版本号，返回 true 表示 remote > local */
function isNewer (local: string, remote: string): boolean {
  const normalize = (v: string) => v.replace(/^v/i, '');
  const lp = normalize(local).split('.').map(Number);
  const rp = normalize(remote).split('.').map(Number);
  for (let i = 0; i < Math.max(lp.length, rp.length); i++) {
    const l = lp[i] || 0;
    const r = rp[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false;
}

/** 通过 pluginManager 获取已安装插件列表 */
function getInstalledFromManager (): PluginInfo[] {
  const pm = pluginState.pluginManager;
  if (!pm) {
    pluginState.log('warn', 'pluginManager 不可用');
    return [];
  }
  const all = pm.getAllPlugins();
  const plugins: PluginInfo[] = all
    .filter((p: any) => !!p.id)
    .map((p: any) => {
      // 优先使用 package.json 的 name 作为标识（与商店索引一致）
      const pkgName = p.packageJson?.name;
      const pluginId = pkgName || p.id || p.fileId;
      pluginState.debug(`插件: id=${p.id}, fileId=${p.fileId}, pkg.name=${pkgName} → 使用 ${pluginId}`);
      return {
        name: pluginId,
        internalId: String(p.id),
        displayName: p.packageJson?.plugin || p.name || p.id,
        currentVersion: p.version || '0.0.0',
        status: !p.enable ? 'disabled' : p.loaded ? 'active' : 'stopped',
        homepage: p.packageJson?.homepage || '',
      };
    });
  pluginState.installedPlugins = plugins;
  pluginState.debug(`已安装 ${plugins.length} 个插件`);
  return plugins;
}

/** 从商店索引获取最新版本信息（与 NapCat PluginStore.ts fetchPluginList 逻辑一致） */
async function fetchStoreIndex (): Promise<Map<string, StorePlugin>> {
  // 如果用户选择了固定镜像，优先使用
  const selected = pluginState.config.selectedRawMirror;
  const mirrors = selected ? [selected, ...GITHUB_RAW_MIRRORS.filter(m => m !== selected)] : GITHUB_RAW_MIRRORS;

  let bestMap = new Map<string, StorePlugin>();

  for (const source of PLUGIN_STORE_SOURCES) {
    for (const mirror of mirrors) {
      try {
        // 与 NapCat 完全一致的 URL 构建逻辑，加时间戳破 CDN 缓存
        const baseUrl = mirror
          ? `${mirror}/${source.replace('https://raw.githubusercontent.com/', '')}`
          : source;
        const url = `${baseUrl}?t=${Date.now()}`;
        pluginState.debug(`尝试获取商店索引: ${baseUrl}`);
        const res = await fetch(url, {
          headers: { 'User-Agent': 'NapCat-WebUI', 'Cache-Control': 'no-cache' },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json() as any;
        const plugins = data.plugins || [];
        const map = new Map<string, StorePlugin>();
        for (const p of plugins) {
          map.set(p.id, p);
        }
        if (map.size === 0) {
          pluginState.debug(`镜像返回空插件列表，尝试下一个`);
          continue;
        }
        const label = mirror === 'https://raw.githubusercontent.com' ? '直连' : (mirror ? '镜像' : '直连');
        pluginState.debug(`${label} 返回 ${map.size} 个插件`);

        // 如果这个结果比之前的多，替换
        if (map.size > bestMap.size) {
          bestMap = map;
        }

        // 直连或用户指定的镜像，直接信任返回
        if (mirror === 'https://raw.githubusercontent.com' || mirror === selected) {
          pluginState.log('info', `商店索引获取成功（${label}），共 ${map.size} 个插件`);
          pluginState.debug(`商店插件列表: ${[...map.keys()].join(', ')}`);
          return map;
        }

        // 镜像结果先存着，继续尝试看有没有更完整的
        // 但如果已经拿到一个结果且不是第一个镜像，就不再继续了（避免太慢）
        if (bestMap.size > 0) {
          pluginState.log('info', `商店索引获取成功（${label}），共 ${bestMap.size} 个插件`);
          pluginState.debug(`商店插件列表: ${[...bestMap.keys()].join(', ')}`);
          return bestMap;
        }
      } catch (e) {
        pluginState.debug(`镜像失败 [${mirror || '直连'}]: ${e}`);
      }
    }
  }

  if (bestMap.size > 0) {
    pluginState.log('info', `商店索引获取成功，共 ${bestMap.size} 个插件`);
    pluginState.debug(`商店插件列表: ${[...bestMap.keys()].join(', ')}`);
    return bestMap;
  }

  pluginState.log('error', `所有商店索引源均不可用（共尝试 ${mirrors.length} 个镜像）`);
  return bestMap;
}

/** 检查所有插件更新 */
export async function checkAllUpdates (): Promise<UpdateInfo[]> {
  pluginState.log('info', '开始检查插件更新...');

  const installed = getInstalledFromManager();
  const storeMap = await fetchStoreIndex();

  // 清理 autoUpdatePlugins 中已不存在的插件
  const installedNames = new Set(installed.map(p => p.name));
  const autoList = pluginState.config.autoUpdatePlugins;
  if (autoList.length > 0) {
    const cleaned = autoList.filter(name => installedNames.has(name));
    if (cleaned.length !== autoList.length) {
      pluginState.config.autoUpdatePlugins = cleaned;
      pluginState.saveConfig();
      pluginState.debug(`已清理 ${autoList.length - cleaned.length} 个不存在的自动更新插件`);
    }
  }

  if (storeMap.size === 0) {
    pluginState.log('warn', '商店索引为空，无法检查更新（可能是网络问题）');
    return [];
  }

  const ignored = new Set(pluginState.config.ignoredPlugins);
  const updates: UpdateInfo[] = [];

  for (const plugin of installed) {
    if (ignored.has(plugin.name)) continue;
    const storeInfo = storeMap.get(plugin.name);
    if (!storeInfo) {
      pluginState.debug(`${plugin.name} 不在商店中，跳过`);
      continue;
    }
    if (isNewer(plugin.currentVersion, storeInfo.version)) {
      updates.push({
        pluginName: plugin.name,
        displayName: plugin.displayName,
        currentVersion: plugin.currentVersion,
        latestVersion: storeInfo.version,
        downloadUrl: storeInfo.downloadUrl,
        changelog: '',
        publishedAt: '',
      });
    } else {
      pluginState.debug(`${plugin.name} 已是最新 (${plugin.currentVersion})`);
    }
  }

  pluginState.availableUpdates = updates;
  pluginState.lastCheckTime = Date.now();

  if (updates.length > 0) {
    pluginState.log('info', `发现 ${updates.length} 个可更新: ${updates.map(u => `${u.displayName} ${u.currentVersion} → ${u.latestVersion}`).join(', ')}`);
  } else {
    pluginState.log('info', '所有插件均为最新版本');
  }
  return updates;
}


/** 根据插件包名（商店 id）查找 NapCat 内部 id */
function resolveInternalId (pluginName: string): string {
  const found = pluginState.installedPlugins.find(p => p.name === pluginName);
  return found?.internalId || pluginName;
}

/** 检查单个插件更新 */
export async function checkSinglePlugin (pluginName: string): Promise<UpdateInfo | null> {
  pluginState.log('info', `检查单个插件更新: ${pluginName}`);

  const pm = pluginState.pluginManager;
  if (!pm) { pluginState.log('warn', 'pluginManager 不可用'); return null; }

  const internalId = resolveInternalId(pluginName);
  const entry = pm.getPluginInfo(internalId);
  if (!entry) { pluginState.log('warn', `未找到插件: ${pluginName} (内部id: ${internalId})`); return null; }

  const currentVersion = entry.version || '0.0.0';
  const storeMap = await fetchStoreIndex();
  const storeInfo = storeMap.get(pluginName);
  if (!storeInfo) { pluginState.log('info', `${pluginName} 不在商店中`); return null; }

  // 更新 installedPlugins 中的版本
  const installed = pluginState.installedPlugins.find(p => p.name === pluginName);
  if (installed) installed.currentVersion = currentVersion;

  // 先移除旧的更新记录
  pluginState.availableUpdates = pluginState.availableUpdates.filter(u => u.pluginName !== pluginName);

  if (isNewer(currentVersion, storeInfo.version)) {
    const update: UpdateInfo = {
      pluginName,
      displayName: entry.packageJson?.plugin || entry.name || pluginName,
      currentVersion,
      latestVersion: storeInfo.version,
      downloadUrl: storeInfo.downloadUrl,
      changelog: '',
      publishedAt: '',
    };
    pluginState.availableUpdates.push(update);
    pluginState.log('info', `${pluginName}: ${currentVersion} → ${storeInfo.version} 有更新`);
    return update;
  }

  pluginState.log('info', `${pluginName} 已是最新 (${currentVersion})`);
  return null;
}

/** 下载文件（带镜像重试，优先使用用户选择的镜像） */
async function downloadWithMirror (url: string, destPath: string): Promise<void> {
  const selected = pluginState.config.selectedDownloadMirror;
  const mirrors = selected ? [selected, ...DOWNLOAD_MIRRORS.filter(m => m !== selected)] : DOWNLOAD_MIRRORS;

  for (const mirror of mirrors) {
    try {
      const finalUrl = mirror ? `${mirror}${url}` : url;
      pluginState.debug(`下载: ${finalUrl}`);
      const res = await fetch(finalUrl, {
        headers: { 'User-Agent': 'napcat-plugin-autoupdate' },
        signal: AbortSignal.timeout(120000),
        redirect: 'follow',
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const fileStream = createWriteStream(destPath);
      await pipeline(Readable.fromWeb(res.body as any), fileStream);
      return;
    } catch (e) {
      pluginState.debug(`镜像 ${mirror || '直连'} 下载失败: ${e}`);
    }
  }
  throw new Error('所有下载镜像均失败');
}

/** 解压 zip 到目标目录 */
async function extractZip (zipPath: string, destDir: string): Promise<void> {
  const { execSync } = await import('child_process');
  const tmpExtract = destDir + '_extract_tmp';
  if (fs.existsSync(tmpExtract)) fs.rmSync(tmpExtract, { recursive: true, force: true });
  fs.mkdirSync(tmpExtract, { recursive: true });

  const isWin = process.platform === 'win32';
  if (isWin) {
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tmpExtract}' -Force"`, { timeout: 30000 });
  } else {
    execSync(`unzip -o "${zipPath}" -d "${tmpExtract}"`, { timeout: 30000 });
  }

  // 找到实际内容目录（可能有一层嵌套）
  let sourceDir = tmpExtract;
  const entries = fs.readdirSync(tmpExtract);
  if (entries.length === 1) {
    const single = path.join(tmpExtract, entries[0]);
    if (fs.statSync(single).isDirectory()) sourceDir = single;
  }

  // 复制到目标目录
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  copyDirSync(sourceDir, destDir);

  // 清理
  fs.rmSync(tmpExtract, { recursive: true, force: true });
}

function copyDirSync (src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 安装/更新单个插件 */
export async function installPlugin (update: UpdateInfo): Promise<boolean> {
  const pm = pluginState.pluginManager;
  if (!pm) {
    pluginState.log('error', 'pluginManager 不可用');
    return false;
  }

  pluginState.log('info', `正在更新 ${update.displayName} 到 v${update.latestVersion}...`);

  const internalId = resolveInternalId(update.pluginName);
  const pluginsDir = pm.getPluginPath();
  const pluginDir = path.join(pluginsDir, internalId);
  const tmpZip = path.join(pluginsDir, `${internalId}.temp.zip`);

  try {
    // 下载
    await downloadWithMirror(update.downloadUrl, tmpZip);

    // 备份用户配置
    const configBackup = path.join(pluginsDir, `${internalId}.config.bak`);
    const userConfigPath = path.join(pluginDir, 'data', 'config.json');
    if (fs.existsSync(userConfigPath)) {
      fs.copyFileSync(userConfigPath, configBackup);
    }

    // 解压覆盖
    await extractZip(tmpZip, pluginDir);

    // 恢复用户配置
    if (fs.existsSync(configBackup)) {
      const dataDir = path.join(pluginDir, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.copyFileSync(configBackup, userConfigPath);
      fs.unlinkSync(configBackup);
    }

    // 通过 pluginManager 重载插件
    const existing = pm.getPluginInfo(internalId);
    if (existing) {
      await pm.reloadPlugin(internalId);
    } else {
      await pm.loadPluginById(internalId);
    }

    // 更新成功后，从 availableUpdates 中移除该插件
    pluginState.availableUpdates = pluginState.availableUpdates.filter(u => u.pluginName !== update.pluginName);

    // 重新读取版本确认更新成功
    const updatedInfo = pm.getPluginInfo(internalId);
    const newVer = updatedInfo?.version || update.latestVersion;
    pluginState.log('info', `✅ ${update.displayName} 已更新到 v${newVer}`);

    // 同步 installedPlugins 中的版本
    const installed = pluginState.installedPlugins.find(p => p.name === update.pluginName);
    if (installed) installed.currentVersion = newVer;

    return true;
  } catch (e) {
    pluginState.log('error', `更新 ${update.displayName} 失败: ${e}`);
    return false;
  } finally {
    if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
  }
}

/** 获取已安装插件列表（供 API 使用） */
export async function getInstalledPlugins (): Promise<PluginInfo[]> {
  return getInstalledFromManager();
}

/** 给镜像打标签 */
function mirrorLabel (url: string): string {
  if (!url || url === 'https://raw.githubusercontent.com') return '直连 (raw.githubusercontent.com)';
  try {
    return new URL(url).hostname;
  } catch { return url; }
}

function downloadMirrorLabel (url: string): string {
  if (!url) return '直连 (github.com)';
  try {
    return new URL(url).hostname;
  } catch { return url; }
}

/** Ping 所有 Raw 镜像，返回延迟结果 */
export async function pingRawMirrors (): Promise<MirrorPingResult[]> {
  const source = PLUGIN_STORE_SOURCES[0];
  const pathPart = source.replace('https://raw.githubusercontent.com/', '');
  const results = await Promise.all(GITHUB_RAW_MIRRORS.map(async (mirror) => {
    const url = mirror ? `${mirror}/${pathPart}` : source;
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'napcat-plugin-autoupdate' },
        signal: AbortSignal.timeout(8000),
      });
      const latency = Date.now() - start;
      return { url: mirror, label: mirrorLabel(mirror), latency, ok: res.ok };
    } catch {
      return { url: mirror, label: mirrorLabel(mirror), latency: -1, ok: false };
    }
  }));
  return results.sort((a, b) => {
    if (a.ok && !b.ok) return -1;
    if (!a.ok && b.ok) return 1;
    return a.latency - b.latency;
  });
}

/** Ping 所有下载镜像，返回延迟结果 */
export async function pingDownloadMirrors (): Promise<MirrorPingResult[]> {
  // 用一个实际存在的 release URL 做 HEAD 测试
  const testUrl = 'https://github.com/NapNeko/NapCatQQ/releases/latest';
  const results = await Promise.all(DOWNLOAD_MIRRORS.map(async (mirror) => {
    const url = mirror ? `${mirror}${testUrl}` : testUrl;
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'napcat-plugin-autoupdate' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      const latency = Date.now() - start;
      return { url: mirror, label: downloadMirrorLabel(mirror), latency, ok: res.status >= 200 && res.status < 400 };
    } catch {
      return { url: mirror, label: downloadMirrorLabel(mirror), latency: -1, ok: false };
    }
  }));
  return results.sort((a, b) => {
    if (a.ok && !b.ok) return -1;
    if (!a.ok && b.ok) return 1;
    return a.latency - b.latency;
  });
}

/** 从 GitHub 仓库安装插件（获取最新 release 的 zip 资产） */
export async function installFromGithub (repo: string): Promise<{ success: boolean; version?: string; error?: string; }> {
  const pm = pluginState.pluginManager;
  if (!pm) return { success: false, error: 'pluginManager 不可用' };

  pluginState.log('info', `正在从 GitHub 安装: ${repo}`);

  const pluginName = repo.split('/').pop() || repo;
  const pluginsDir = pm.getPluginPath();
  const pluginDir = path.join(pluginsDir, pluginName);
  const tmpZip = path.join(pluginsDir, `${pluginName}.temp.zip`);

  try {
    // 获取最新 release 信息
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    let releaseData: any = null;
    try {
      pluginState.debug(`获取 release 信息: ${apiUrl}`);
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'napcat-plugin-autoupdate', Accept: 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      releaseData = await res.json();
    } catch (e) {
      pluginState.debug(`获取 release 失败: ${e}`);
    }

    if (!releaseData) return { success: false, error: '无法获取 GitHub Release 信息' };

    const version = (releaseData.tag_name || '').replace(/^v/i, '');
    pluginState.log('info', `最新版本: ${version || releaseData.tag_name}`);

    // 找到 zip 资产
    let downloadUrl = '';
    const assets = releaseData.assets || [];
    const zipAsset = assets.find((a: any) => a.name && a.name.endsWith('.zip'));
    if (zipAsset) {
      downloadUrl = zipAsset.browser_download_url;
    } else {
      downloadUrl = releaseData.zipball_url || '';
    }
    if (!downloadUrl) return { success: false, error: '未找到可下载的 zip 文件' };

    pluginState.log('info', `下载地址: ${downloadUrl}`);

    // 备份用户配置
    const configBackup = path.join(pluginsDir, `${pluginName}.config.bak`);
    const userConfigPath = path.join(pluginDir, 'data', 'config.json');
    if (fs.existsSync(userConfigPath)) {
      fs.copyFileSync(userConfigPath, configBackup);
    }

    // 下载 & 解压
    await downloadWithMirror(downloadUrl, tmpZip);
    await extractZip(tmpZip, pluginDir);

    // 恢复用户配置
    if (fs.existsSync(configBackup)) {
      const dataDir = path.join(pluginDir, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.copyFileSync(configBackup, userConfigPath);
      fs.unlinkSync(configBackup);
    }

    // 加载/重载插件
    const existing = pm.getPluginInfo(pluginName);
    if (existing) {
      await pm.reloadPlugin(pluginName);
    } else {
      await pm.loadPluginById(pluginName);
    }

    pluginState.log('info', `✅ ${pluginName} 安装成功 (v${version})`);
    return { success: true, version };
  } catch (e) {
    pluginState.log('error', `安装 ${pluginName} 失败: ${e}`);
    return { success: false, error: String(e) };
  } finally {
    if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
  }
}

/** 检查 GitHub 仓库最新 release 版本 */
export async function checkGithubRelease (repo: string): Promise<{ version: string; publishedAt: string; } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'napcat-plugin-autoupdate', Accept: 'application/vnd.github.v3+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return {
      version: (data.tag_name || '').replace(/^v/i, ''),
      publishedAt: data.published_at || '',
    };
  } catch {
    return null;
  }
}
