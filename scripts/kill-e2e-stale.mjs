#!/usr/bin/env node
import { spawn } from 'node:child_process';

const PORTS = [1420, 4445];
const PORT_LABELS = { 1420: 'vite dev server', 4445: 'wdio embedded webdriver' };
const GRACE_MS = 800;
const TAG = '[kill-e2e-stale]';

function tryRun(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.on('error', () => resolve({ ran: false, code: null, stdout, stderr }));
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ ran: true, code, stdout, stderr }));
  });
}

function extractPids(text) {
  const pids = new Set();
  for (const token of String(text).split(/[\s,;]+/)) {
    const n = Number(token);
    if (Number.isInteger(n) && n > 0 && n !== process.pid) pids.add(n);
  }
  return [...pids];
}

async function findListenerPids(port) {
  const suffix = `:${port}`;

  if (process.platform === 'win32') {
    const r = await tryRun('netstat', ['-ano', '-p', 'tcp']);
    if (!r.ran) throw new Error('netstat 不可用');
    const pids = new Set();
    for (const line of r.stdout.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (
        cols.length >= 5 &&
        cols[0].toUpperCase() === 'TCP' &&
        cols[3].toUpperCase() === 'LISTENING' &&
        cols[1].endsWith(suffix)
      ) {
        const pid = Number(cols[4]);
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
      }
    }
    return [...pids];
  }

  if (process.platform === 'darwin') {
    const r = await tryRun('lsof', ['-t', '-i', suffix, '-sTCP:LISTEN']);
    if (!r.ran) throw new Error('lsof 不可用');
    return extractPids(r.stdout);
  }

  const ss = await tryRun('ss', ['-ltnp', `sport = ${suffix}`]);
  if (ss.ran && ss.stdout) {
    const pids = [...new Set(
      [...ss.stdout.matchAll(/pid=(\d+)/g)]
        .map((m) => Number(m[1]))
        .filter((p) => p !== process.pid),
    )];
    if (pids.length > 0) return pids;
  }
  const lsof = await tryRun('lsof', ['-t', '-i', suffix, '-sTCP:LISTEN']);
  if (lsof.ran && lsof.stdout.trim()) return extractPids(lsof.stdout);
  const fuser = await tryRun('fuser', ['-n', 'tcp', String(port)]);
  if (fuser.ran) return extractPids(`${fuser.stdout} ${fuser.stderr}`);
  throw new Error('ss/lsof/fuser 均不可用');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function terminate(pid) {
  if (process.platform === 'win32') {
    await tryRun('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  await delay(GRACE_MS);
  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
    await delay(GRACE_MS);
  }
}

async function main() {
  console.log(`${TAG} CL-033 守卫启动，探测残留监听：${PORTS.map((p) => `${p}(${PORT_LABELS[p]})`).join(' / ')}`);
  for (const port of PORTS) {
    try {
      const pids = await findListenerPids(port);
      if (pids.length === 0) {
        console.log(`${TAG} 端口 ${port}：无残留`);
        continue;
      }
      console.log(`${TAG} 端口 ${port}：发现残留监听 PID ${pids.join(', ')}，开始终止`);
      for (const pid of pids) {
        await terminate(pid);
      }
      const remaining = await findListenerPids(port);
      if (remaining.length > 0) {
        console.warn(`${TAG} 警告：端口 ${port} 的 PID ${remaining.join(', ')} 未能终止，按尽力而为语义继续`);
      } else {
        console.log(`${TAG} 端口 ${port}：清理完成`);
      }
    } catch (err) {
      console.warn(`${TAG} 警告：端口 ${port} 探测失败（${err.message}），按尽力而为语义继续`);
    }
  }
}

main().catch((err) => {
  console.warn(`${TAG} 警告：守卫自身异常（${err?.message ?? err}），按尽力而为语义继续`);
});
