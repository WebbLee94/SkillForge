-- ============================================================================
-- SkillForge 用户库一次性迁移：六旧表 → 统一资源三表
-- （47 号方案 §四终稿 / T4 裁决交付物 · 2026-08-24）
--
-- 迁移内容：
--   skills / rules                → resources        （kind='skill' / 'rule'）
--   skill_tags / rule_tags        → resource_tags    （经 tags 存在性校验）
--   scene_skills / scene_rules    → scene_items      （version/config 列丢弃，T3 裁决）
--
-- ── 执行前置条件（红线流程，缺一不可）────────────────────────────────────
--   1. 完全退出 SkillForge 应用（含后台进程）；
--   2. 先执行 scripts/backup-dev-db.sh 生成备份并确认 integrity_check=ok；
--   3. 确认 sqlite3 CLI 可用：sqlite3 --version（需 ≥ 3.35）。
--
-- ── 执行方式 ────────────────────────────────────────────────────────────
--   sqlite3 ~/.skillforge/skillforge.db < src-tauri/scripts/migrate-to-unified-resources.sql
--   （必须经 sqlite3 CLI 执行：脚本依赖 .bail on 点命令实现"出错即中止"）
--
-- ── 幂等性说明 ──────────────────────────────────────────────────────────
--   - 全部变更包裹在单一事务中：任一步失败整体回滚，库保持迁移前状态，
--     可直接修正后重跑；
--   - 建表用 IF NOT EXISTS、数据搬迁用 WHERE NOT EXISTS 去重：
--     若应用曾以新二进制启动过（新表已建但为空/部分有数据），重跑安全；
--   - 事务成功提交后六旧表已删除，再次执行会在【预检 0】处以
--     "no such table" 报错退出——该报错本身即"迁移已完成"信号，无需处理。
--
-- ── 回滚方式 ────────────────────────────────────────────────────────────
--   本脚本不提供 SQL 级反向回滚。还原依赖第 2 步的前置备份文件：
--   退出应用 → 用 ~/skillforge-backups/<时间戳>/ 中的 skillforge.db(-wal/-shm)
--   覆盖 ~/.skillforge/ 下同名文件 → 同时将应用二进制回退至换底前版本
--   （47 号方案 §八）。因此备份文件是唯一回滚凭据，执行前务必妥善留存。
-- ============================================================================

-- 任何语句出错立即中止整个脚本（sqlite3 CLI 点命令）。
-- 没有 .bail 时 CLI 会带着错误继续执行后续 DROP/COMMIT，造成部分迁移落库——
-- 本脚本的 fail-closed 保证依赖此行，不可删除。
.bail on

-- 预检 0：旧表存在性自检（六表应全部存在 ⇒ present_count=6，可执行；
-- 若输出 present_count=0 说明迁移已完成，本脚本无需再次运行）
SELECT 'preflight:legacy_tables_present' AS check_item,
       (SELECT COUNT(*) FROM sqlite_master
         WHERE type='table'
           AND name IN ('skills','rules','skill_tags','rule_tags',
                        'scene_skills','scene_rules')) AS present_count;

-- 预检 1：跨 kind 同 id 冲突检测（关键！）
-- 输出交集清单供消歧参考；下方预检 1b 硬闸门负责强制中止。
SELECT 'preflight:id_conflict' AS check_item, s.id AS conflicting_id,
       '同时存在于 skills 与 rules' AS detail
  FROM skills s
  JOIN rules r ON r.id = s.id;

-- 预检 1b：冲突硬闸门——存在任一冲突即 CHECK 失败中止（在任何写操作之前）。
-- 这是兜底防线：即便忽略预检清单强行执行，也无法带伤进入搬迁阶段。
CREATE TEMP TABLE IF NOT EXISTS cross_kind_id_guard (
    no_conflict INTEGER CONSTRAINT conflict_must_be_zero CHECK (no_conflict = 0)
);
INSERT INTO cross_kind_id_guard (no_conflict)
SELECT EXISTS(SELECT 1 FROM skills s JOIN rules r ON r.id = s.id LIMIT 1);

-- 预检 2：旧表行数清单（预期基线：skills=46，rules=7；其余以实际为准）
SELECT 'preflight:rowcount' AS check_item, 'skills' AS tbl, COUNT(*) AS rows FROM skills
UNION ALL SELECT 'preflight:rowcount', 'rules',      COUNT(*) FROM rules
UNION ALL SELECT 'preflight:rowcount', 'tags',       COUNT(*) FROM tags
UNION ALL SELECT 'preflight:rowcount', 'skill_tags', COUNT(*) FROM skill_tags
UNION ALL SELECT 'preflight:rowcount', 'rule_tags',  COUNT(*) FROM rule_tags
UNION ALL SELECT 'preflight:rowcount', 'scene_skills', COUNT(*) FROM scene_skills
UNION ALL SELECT 'preflight:rowcount', 'scene_rules',  COUNT(*) FROM scene_rules;

-- 预检 3：孤儿关联提示（信息性输出；搬迁时会被 INNER JOIN 自动丢弃）
SELECT 'preflight:orphan_tag_links' AS check_item, COUNT(*) AS orphan_rows
  FROM skill_tags st LEFT JOIN skills s ON s.id = st.skill_id
  WHERE s.id IS NULL
UNION ALL
SELECT 'preflight:orphan_tag_links', COUNT(*)
  FROM rule_tags rt LEFT JOIN rules r ON r.id = rt.rule_id
  WHERE r.id IS NULL
UNION ALL
SELECT 'preflight:orphan_scene_links', COUNT(*)
  FROM scene_skills ss LEFT JOIN scenes sc ON sc.id = ss.scene_id
  WHERE sc.id IS NULL;

BEGIN IMMEDIATE;

-- ============================================================================
-- 1) 建三张新表（DDL 与 src/db/schema.rs v1.1.0 终稿逐字一致）
-- ============================================================================

CREATE TABLE IF NOT EXISTS resources (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('skill','rule')),
    name         TEXT NOT NULL,
    description  TEXT,
    source_type  TEXT NOT NULL,
    source_url   TEXT,
    current_ver  TEXT,
    installed_at TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    local_path   TEXT,
    metadata     TEXT,
    format       TEXT,
    content      TEXT,
    platform     TEXT,
    scope        TEXT,
    version      INTEGER NOT NULL DEFAULT 1,
    CHECK ((kind='skill' AND content IS NULL AND format IS NULL AND local_path IS NOT NULL)
        OR (kind='rule'  AND content IS NOT NULL AND local_path IS NULL))
);

CREATE TABLE IF NOT EXISTS resource_tags (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (resource_id, tag_id)
);

CREATE TABLE IF NOT EXISTS scene_items (
    scene_id    TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    enabled     INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (scene_id, resource_id)
);

-- 新基线索索引自（与 schema.rs 一致；idx_skills_source_type /
-- idx_scene_skills_scene 随旧表消亡，由前两个新索引取代）
CREATE INDEX IF NOT EXISTS idx_resources_source_type ON resources(source_type);
CREATE INDEX IF NOT EXISTS idx_resources_kind ON resources(kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_type ON tags(name, tag_type);
CREATE INDEX IF NOT EXISTS idx_scene_items_scene ON scene_items(scene_id);

-- ============================================================================
-- 2) 数据搬迁
-- ============================================================================

-- 2.1 skills → resources(kind='skill')
--     source_type 沿用原值（local-fs / git-repo）；installed_at 沿用原值，
--     updated_at 与 installed_at 同值起步（与 insert_skill_row 投影约定一致）；
--     死列 content_hash / sync_status 不搬迁（全仓零读写取证）。
INSERT INTO resources (id, kind, name, description, source_type, source_url,
                       current_ver, installed_at, updated_at, local_path, metadata)
SELECT s.id, 'skill', s.name, s.description, s.source_type, s.source_url,
       s.current_ver, s.installed_at, s.installed_at, s.local_path, s.metadata
  FROM skills s
 WHERE NOT EXISTS (SELECT 1 FROM resources r WHERE r.id = s.id AND r.kind = 'skill');

-- 2.2 rules → resources(kind='rule')
--     source_type 统一投影为 'manual'（旧 rules 表无此列，RULE_SOURCE_TYPE 约定）；
--     updated_at 沿用原值，installed_at 与 updated_at 同值起步。
--     若与已迁技能行 id 冲突，此处主键冲突将中止整个事务（预检 1 的兜底）。
INSERT INTO resources (id, kind, name, description, source_type, source_url,
                       current_ver, installed_at, updated_at,
                       format, content, platform, scope, version)
SELECT r.id, 'rule', r.name, r.description, 'manual', NULL,
       NULL, r.updated_at, r.updated_at,
       r.format, r.content, r.platform, r.scope, r.version
  FROM rules r
 WHERE NOT EXISTS (SELECT 1 FROM resources x WHERE x.id = r.id AND x.kind = 'rule');

-- 2.3 skill_tags / rule_tags → resource_tags
--     双侧校验：INNER JOIN tags（标签存在）+ INNER JOIN resources（资源存在），
--     杜绝孤儿关联行迁入（CLI 默认 foreign_keys=OFF，FK 不兜底）。
INSERT INTO resource_tags (resource_id, tag_id)
SELECT st.skill_id, st.tag_id
  FROM skill_tags st
  JOIN tags t ON t.id = st.tag_id
  JOIN resources r ON r.id = st.skill_id AND r.kind = 'skill'
 WHERE NOT EXISTS (SELECT 1 FROM resource_tags rt
                    WHERE rt.resource_id = st.skill_id AND rt.tag_id = st.tag_id);

INSERT INTO resource_tags (resource_id, tag_id)
SELECT rt.rule_id, rt.tag_id
  FROM rule_tags rt
  JOIN tags t ON t.id = rt.tag_id
  JOIN resources r ON r.id = rt.rule_id AND r.kind = 'rule'
 WHERE NOT EXISTS (SELECT 1 FROM resource_tags x
                    WHERE x.resource_id = rt.rule_id AND x.tag_id = rt.tag_id);

-- 2.4 scene_skills / scene_rules → scene_items
--     version / config 列丢弃（T3：全仓零使用取证）；
--     enabled / sort_order 沿用。INNER JOIN 兜底孤儿成员行。
INSERT INTO scene_items (scene_id, resource_id, enabled, sort_order)
SELECT ss.scene_id, ss.skill_id, ss.enabled, ss.sort_order
  FROM scene_skills ss
  JOIN scenes sc ON sc.id = ss.scene_id
  JOIN resources r ON r.id = ss.skill_id AND r.kind = 'skill'
 WHERE NOT EXISTS (SELECT 1 FROM scene_items si
                    WHERE si.scene_id = ss.scene_id AND si.resource_id = ss.skill_id);

INSERT INTO scene_items (scene_id, resource_id, enabled, sort_order)
SELECT sr.scene_id, sr.rule_id, sr.enabled, sr.sort_order
  FROM scene_rules sr
  JOIN scenes sc ON sc.id = sr.scene_id
  JOIN resources r ON r.id = sr.rule_id AND r.kind = 'rule'
 WHERE NOT EXISTS (SELECT 1 FROM scene_items si
                    WHERE si.scene_id = sr.scene_id AND si.resource_id = sr.rule_id);

-- ============================================================================
-- 2.5 搬迁完整性断言（DROP 前的最后防线）
--     旧表行数必须 ≤ 新表对应 kind 行数，否则 CHECK 失败中止整个事务，
--     六旧表绝不在数据缺失的情况下被删除。
-- ============================================================================

CREATE TEMP TABLE IF NOT EXISTS rowcount_guard (
    migrated_complete INTEGER CONSTRAINT all_rows_migrated CHECK (migrated_complete = 0)
);

INSERT INTO rowcount_guard (migrated_complete)
SELECT (SELECT COUNT(*) FROM skills) > (SELECT COUNT(*) FROM resources WHERE kind = 'skill');

INSERT INTO rowcount_guard (migrated_complete)
SELECT (SELECT COUNT(*) FROM rules) > (SELECT COUNT(*) FROM resources WHERE kind = 'rule');

-- ============================================================================
-- 3) 删除六张旧表
-- ============================================================================

DROP TABLE IF EXISTS scene_skills;
DROP TABLE IF EXISTS scene_rules;
DROP TABLE IF EXISTS skill_tags;
DROP TABLE IF EXISTS rule_tags;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS rules;

COMMIT;

-- ============================================================================
-- 4) 迁移后验收（只读输出，供 lead 逐项核对）
--    验收口径：resources 两 kind 行数之和 = 预检 2 中 skills+rules；
--             resource_tags 行数 ≤ skill_tags+rule_tags（差值=孤儿/去重）；
--             scene_items 行数 ≤ scene_skills+scene_rules。
-- ============================================================================

SELECT 'verify:resources_by_kind' AS check_item, kind, COUNT(*) AS rows
  FROM resources GROUP BY kind ORDER BY kind;

SELECT 'verify:resource_tags_total' AS check_item, COUNT(*) AS rows FROM resource_tags;
SELECT 'verify:scene_items_total'  AS check_item, COUNT(*) AS rows FROM scene_items;

-- 残留检查：任何旧表引用都应为 0
SELECT 'verify:legacy_leftovers' AS check_item,
       (SELECT COUNT(*) FROM sqlite_master
         WHERE type='table'
           AND name IN ('skills','rules','skill_tags','rule_tags',
                        'scene_skills','scene_rules')) AS leftover_tables;

-- 完整性收尾：WAL 收敛（应用未运行时安全）
PRAGMA wal_checkpoint(TRUNCATE);
PRAGMA integrity_check;
