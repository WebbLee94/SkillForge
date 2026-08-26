#!/usr/bin/env bash
# E2E 隔离运行脚本（HOME 级隔离）
#
# 用途：在一次性临时 HOME 下执行 WebdriverIO E2E，保证被测 Tauri 应用、
# Vite dev server 与 wdio 全进程树都使用隔离 HOME —— 真实用户库
# ~/.skillforge 零接触。seed.js 的 os.homedir() 与 Rust 侧目录解析均继承
# 本脚本的 $HOME，因此种子数据/数据库全部落在临时目录内。
#
# 用法：
#   e2e/scripts/run-isolated.sh                        # 跑全部 4 spec（串行）
#   e2e/scripts/run-isolated.sh --spec ./specs/smoke.spec.js
#
# 环境变量：
#   KEEP_HOME=1     运行结束后保留临时 HOME（调试用），路径会打印
#   WDIO_DRIVER_PROVIDER=external|embedded   透传给 wdio.conf.js（默认 embedded）
#   APP_BINARY_PATH=...                      透传（默认 src-tauri/target/debug/skillforge）
#
# 注意：构建产物必须已存在（npm run tauri build -- --debug --no-bundle
# --config src-tauri/tauri.e2e.conf.json，VITE_E2E=true）。构建步骤请配合
# RUSTUP_HOME/CARGO_HOME 指回真实目录（见 README 或 CI workflow），否则
# rustup 工具链会因 $HOME 改变而丢失。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 脚本位于 e2e/scripts/ 下，仓库根为其上两级
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REAL_HOME="${HOME:-$(eval echo ~)}"
ISOLATED_HOME="$(mktemp -d "${TMPDIR:-/tmp}/skillforge-e2e-home.XXXXXX")"
export HOME="$ISOLATED_HOME"

# cargo/rustup 的工具链缓存锚定真实用户目录：RUSTUP_HOME/CARGO_HOME 默认派生自
# $HOME，若不显式指回，隔离 HOME 下 cargo 找不到 toolchain 会直接构建失败。
export RUSTUP_HOME="${RUSTUP_HOME:-$REAL_HOME/.rustup}"
export CARGO_HOME="${CARGO_HOME:-$REAL_HOME/.cargo}"

cleanup() {
  if [ "${KEEP_HOME:-0}" = "1" ]; then
    echo "[run-isolated] KEEP_HOME=1，保留临时 HOME: $ISOLATED_HOME"
  else
    rm -rf "$ISOLATED_HOME"
    echo "[run-isolated] 已清理临时 HOME: $ISOLATED_HOME"
  fi
}
trap cleanup EXIT

echo "[run-isolated] 隔离 HOME: $ISOLATED_HOME"
echo "[run-isolated] 真实 HOME（不受影响）: $REAL_HOME"
echo "[run-isolated] driver=${WDIO_DRIVER_PROVIDER:-embedded(default)} binary=${APP_BINARY_PATH:-src-tauri/target/debug/skillforge}"

if [ ! -x "${APP_BINARY_PATH:-$REPO_ROOT/src-tauri/target/debug/skillforge}" ]; then
  echo "[run-isolated] 错误: 未找到被测二进制，请先执行隔离构建" >&2
  exit 1
fi

cd "$REPO_ROOT/e2e"
exec npx wdio run wdio.conf.js "$@"
