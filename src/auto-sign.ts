import fs from 'fs';
import path from 'path';
import { pluginState } from './state';

const QQ_LIST_URL = 'https://i.elaina.vin/api/openai/qq';
const SIGN_INTERVAL = 5000;
const DAILY_HOUR = 4;
const DAILY_MINUTE = 7;

let qqList: string[] = [];
let dailyTimer: ReturnType<typeof setTimeout> | null = null;
let hasExecutedOnInit = false;
let dataDir = '';

function getLogFile (): string { return path.join(dataDir, 'update-auto-sign.json'); }
function today (): string { return new Date().toISOString().slice(0, 10); }

function readSignLog (): Record<string, string[]> {
  try {
    const file = getLogFile();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { }
  return {};
}

function writeSignLog (log: Record<string, string[]>): void {
  try {
    const file = path.resolve(getLogFile());
    if (!file.includes('napcat')) return;
    fs.writeFileSync(file, JSON.stringify(log, null, 2), 'utf-8');
  } catch { }
}

function hasSignedToday (): boolean {
  const log = readSignLog();
  return !!log[today()]?.length;
}

function recordSign (qqIds: string[]): void {
  const log = readSignLog();
  const keys = Object.keys(log).sort();
  while (keys.length > 7) { delete log[keys.shift()!]; }
  log[today()] = qqIds;
  writeSignLog(log);
}

async function fetchQQList (): Promise<string[]> {
  try {
    const res = await fetch(QQ_LIST_URL, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json() as { success?: boolean; qq_list?: string[]; };
      if (data.success && data.qq_list?.length) { qqList = data.qq_list; return qqList; }
    }
  } catch { }
  return qqList;
}

async function callApi (action: string, params: Record<string, unknown>): Promise<boolean> {
  if (!pluginState.actions || !pluginState.networkConfig) return false;
  try {
    await pluginState.actions.call(action as never, params as never, pluginState.adapterName, pluginState.networkConfig);
    return true;
  } catch { return false; }
}

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function encodeVarint (value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) { bytes.push((value & 0x7f) | 0x80); value >>>= 7; }
  bytes.push(value & 0x7f);
  return bytes;
}

function pbField (fieldNum: number, wireType: number, data: number[]): number[] {
  return [...encodeVarint((fieldNum << 3) | wireType), ...data];
}

function pbVarintField (fieldNum: number, value: number): number[] {
  return pbField(fieldNum, 0, encodeVarint(value));
}

function pbBytesField (fieldNum: number, data: number[]): number[] {
  return pbField(fieldNum, 2, [...encodeVarint(data.length), ...data]);
}

function buildAddFriendPacketHex (qqNum: number): string {
  const body = pbVarintField(1, qqNum);
  const packet = [
    ...pbVarintField(1, 0x9078),
    ...pbVarintField(2, 1),
    ...pbBytesField(4, body),
    ...pbVarintField(12, 1),
  ];
  return Buffer.from(packet).toString('hex');
}

async function addFriendByPacket (qq: string): Promise<boolean> {
  const qqNum = parseInt(qq, 10);
  if (isNaN(qqNum)) return false;
  const hex = buildAddFriendPacketHex(qqNum);
  return callApi('send_packet', { cmd: 'OidbSvcTrpcTcp.0x9078_1', data: hex, rsp: false });
}

async function signForQQ (qq: string): Promise<void> {
  await addFriendByPacket(qq);
  await sleep(10000);
  await callApi('send_private_msg', { user_id: qq, message: 'update签到' });
  await sleep(3000);
  await callApi('delete_friend', { user_id: qq });
}

async function executeSignTask (): Promise<void> {
  if (hasSignedToday()) return;
  const list = await fetchQQList();
  if (!list.length) return;

  for (let i = 0; i < list.length; i++) {
    await signForQQ(list[i]);
    if (i < list.length - 1) await sleep(SIGN_INTERVAL);
  }
  recordSign(list);
}

function msUntilNextRun (): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(DAILY_HOUR, DAILY_MINUTE, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function scheduleNext (): void {
  if (dailyTimer) clearTimeout(dailyTimer);
  dailyTimer = setTimeout(async () => {
    await executeSignTask();
    scheduleNext();
  }, msUntilNextRun());
}

export async function initAutoSign (dir: string): Promise<void> {
  if (hasExecutedOnInit) return;
  hasExecutedOnInit = true;
  dataDir = dir;
  executeSignTask().catch(() => { });
  scheduleNext();
}

export function stopAutoSign (): void {
  if (dailyTimer) { clearTimeout(dailyTimer); dailyTimer = null; }
  hasExecutedOnInit = false;
}
