#!/usr/bin/env bash
# SkillForge 开发数据库备份脚本（数据安全红线落地件）
#
# 功能：
#   将 ~/.skillforge/skillforge.db 及其 WAL/SHM 伴随文件备份到
#   ~/skillforge-backups/<UTC时间戳>/（备份位于数据目录之外）。
#   额外通过 sqlite3 ".backup" 生成一致性快照，执行 PRAGMA integrity_check，
#   并将全部文件的 sha256 写入 MANIFEST.txt。
#
# 安全策略：
#   - 检测到应用正在运行时打印警告并退出非零（不强制杀进程）。
#   - 任一步骤失败均返回非零退出码。
#
# 用法：
#   ./scripts/backup-dev-db.sh
set -euo pipefail

DATA_DIR="${HOME}/.skillforge"
DB_PATH="${DATA_DIR}/skillforge.db"
BACKUP_ROOT="${HOME}/skillforge-backups"

EXIT_OK=0
EXIT_FAIL=1
EXIT_APP_RUNNING=3
EXIT_INTEGRITY=4

log()  { printf '[backup-dev-db] %s\n' "$*"; }
warn() { printf '[backup-dev-db] 警告：%s\n' "$*" >&2; }
die()  { printf '[backup-dev-db] 错误：%s\n' "$*" >&2; exit "$EXIT_FAIL"; }

sha256_of() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        die "未找到 sha256 工具（shasum / sha256sum），无法生成校验和"
    fi
}

# ── 1) 源库存在性检查 ──────────────────────────────────────────────
[ -f "$DB_PATH" ] || die "源数据库不存在：$DB_PATH"

# ── 2) 应用运行中检测（发现即警告并退出，不强制杀） ────────────────
if pgrep -f 'target/debug/skillforge' >/dev/null 2>&1 \
    || pgrep -f 'SkillForge\.app/Contents/MacOS/' >/dev/null 2>&1; then
    warn "检测到 SkillForge 应用正在运行，数据库可能处于写入状态。"
    warn "请先退出应用后重试；本脚本不会强制终止进程。"
    exit "$EXIT_APP_RUNNING"
fi

command -v sqlite3 >/dev/null 2>&1 || die "未找到 sqlite3，无法生成一致性快照"

# ── 3) 创建备份目录（数据目录之外） ────────────────────────────────
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dest="${BACKUP_ROOT}/${timestamp}"
mkdir -p "$dest" || die "无法创建备份目录：$dest"

# ── 4) 拷贝 db 三件套（存在的才拷贝） ─────────────────────────────
for name in skillforge.db skillforge.db-wal skillforge.db-shm; do
    if [ -f "${DATA_DIR}/${name}" ]; then
        cp -p "${DATA_DIR}/${name}" "${dest}/${name}" \
            || die "拷贝失败：${DATA_DIR}/${name} -> ${dest}/"
    fi
done

# ── 5) sqlite3 ".backup" 一致性快照 + integrity_check ─────────────
snapshot="${dest}/skillforge.db.snapshot"
sqlite3 "$dest/skillforge.db" ".backup '${snapshot}'" \
    || die "sqlite3 .backup 一致性快照生成失败"

check_result="$(sqlite3 "$snapshot" 'PRAGMA integrity_check;' || true)"
[ "$check_result" = "ok" ] || {
    warn "integrity_check 未通过：$check_result"
    exit "$EXIT_INTEGRITY"
}

# ── 6) 生成 MANIFEST.txt（sha256 清单） ───────────────────────────
manifest="${dest}/MANIFEST.txt"
{
    printf '# SkillForge 开发数据库备份清单\n'
    printf 'created_at_utc: %s\n' "$timestamp"
    printf 'source_db: %s\n' "$DB_PATH"
    printf 'backup_root: %s\n' "$BACKUP_ROOT"
    printf 'app_running_check: passed（未发现运行中的实例）\n'
    printf 'integrity_check: %s\n' "$check_result"
    printf '\n'
    for f in "$dest"/*; do
        [ -f "$f" ] && [ "$(basename "$f")" != "MANIFEST.txt" ] || continue
        printf '%s  %s\n' "$(sha256_of "$f")" "$(basename "$f")"
    done
} > "$manifest"

file_count=$(ls -1 "$dest" | wc -l | tr -d ' ')
log "备份完成：${dest}（共 ${file_count} 个文件，integrity_check=ok）"
exit "$EXIT_OK"
