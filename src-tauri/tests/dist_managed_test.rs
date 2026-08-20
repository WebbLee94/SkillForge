//! Focused tests for `engine::dist_managed` — managed-state / ownership
//! checks / RemoveSelected validations boundaries.
//!
//! TDD note (Phase 5 TASK-034 / TASK-037): these tests reference
//! `skillforge_lib::engine::dist_managed` and were written first (RED);
//! they only compile after `dist_managed` exists as a module owning the
//! moved managed-state functions.

use skillforge_lib::db::migrations;
use skillforge_lib::engine::dist_managed;
use skillforge_lib::plugins::platform::PlatformPlugin;

mod support;

fn init_db() -> rusqlite::Connection {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok();
    migrations::run_migrations(&mut conn).unwrap();
    conn
}

fn insert_skill(conn: &rusqlite::Connection, plugin: &support::TestPlatformPlugin, id: &str) {
    let skill = plugin.create_source_skill(id, id, "---\nname: test\n---\n");
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![skill.id, skill.name, skill.source_type, skill.installed_at, skill.local_path],
    )
    .unwrap();
}

fn insert_rule(conn: &rusqlite::Connection, id: &str, content: &str) {
    conn.execute(
        "INSERT INTO rules (id, name, format, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        rusqlite::params![id, id, "md", content, chrono::Utc::now().to_rfc3339()],
    )
    .unwrap();
}

#[test]
fn managed_state_separates_managed_from_local_entries() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_skill(&conn, &plugin, "managed-skill");
    insert_rule(&conn, "managed-rule", "managed content");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    std::os::unix::fs::symlink(source, plugin.skills_dir().join("managed-skill")).unwrap();
    std::fs::create_dir(plugin.skills_dir().join("unknown-skill")).unwrap();
    std::fs::create_dir_all(plugin.rules_dir()).unwrap();
    std::fs::write(
        plugin.rules_dir().join("managed-rule.md"),
        "managed content",
    )
    .unwrap();
    std::fs::write(plugin.rules_dir().join("local-rule.md"), "local content").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let state = dist_managed::get_managed_distribution_state(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .unwrap();

    assert_eq!(
        state.platforms[0]
            .skills
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        vec!["managed-skill"]
    );
    assert_eq!(
        state.platforms[0]
            .local_skills
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        vec!["unknown-skill"]
    );
    assert_eq!(
        state.platforms[0]
            .rules
            .iter()
            .map(|e| e.id.as_str())
            .collect::<Vec<_>>(),
        vec!["managed-rule"]
    );
    assert_eq!(
        state.platforms[0]
            .local_rules
            .iter()
            .map(|e| e.name.as_str())
            .collect::<Vec<_>>(),
        vec!["local-rule.md"]
    );
}

#[test]
fn managed_state_skips_symlink_not_pointing_at_skill_source() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    // Create a skill in DB whose local_path is somewhere else, then create a
    // symlink in the platform dir that does NOT point at that source.
    let skill = plugin.create_source_skill("managed-skill", "Managed", "---\n---\n");
    conn.execute(
        "INSERT INTO skills (id, name, source_type, installed_at, local_path) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            skill.id,
            skill.name,
            skill.source_type,
            skill.installed_at,
            "/some/other/source".to_string()
        ],
    )
    .unwrap();
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let wrong_target = plugin.skills_dir().join("sources").join("managed-skill");
    std::fs::create_dir_all(&wrong_target).unwrap();
    std::os::unix::fs::symlink(&wrong_target, plugin.skills_dir().join("managed-skill")).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let state = dist_managed::get_managed_distribution_state(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
    )
    .unwrap();

    // The entry is NOT owned (symlink target != skill.local_path), so it
    // must not appear as a managed skill.
    assert!(state.platforms[0].skills.is_empty());
}

#[test]
fn managed_state_rejects_global_with_project_id() {
    let conn = init_db();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![];

    let result = dist_managed::get_managed_distribution_state(
        &conn,
        &plugins,
        &[],
        "global",
        Some("project-a"),
    );

    assert!(matches!(
        result,
        Err(skillforge_lib::error::AppError::DistributionInvalid(message))
            if message.contains("global")
    ));
}

#[test]
fn removeselected_rejects_non_skillforge_symlink_before_mutation() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    // A symlink targeting a foreign dir (≠ skill.local_path) is not owned.
    let foreign = plugin.skills_dir().join("foreign-target");
    std::fs::create_dir_all(&foreign).unwrap();
    std::os::unix::fs::symlink(&foreign, plugin.skills_dir().join("managed-skill")).unwrap();
    let symlink = plugin.skills_dir().join("managed-skill");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];
    let request = skillforge_lib::types::DistributionRequest {
        scene_id: None,
        platform_ids: vec!["test-plat".to_string()],
        scope: "global".to_string(),
        project_id: None,
        skills: skillforge_lib::types::DistributionIntent {
            mode: skillforge_lib::types::DistributionIntentMode::RemoveSelected,
            ids: vec!["managed-skill".to_string()],
        },
        rules: skillforge_lib::types::DistributionIntent {
            mode: skillforge_lib::types::DistributionIntentMode::Preserve,
            ids: vec![],
        },
    };
    let plan = skillforge_lib::engine::dist_plan::build_distribution_plan_for_request(
        &conn, &plugins, &request,
    )
    .unwrap();

    let result = skillforge_lib::engine::dist_execute::execute_distribution_request(
        &conn, &plugins, &request, &plan,
    );

    // Rejection with DistributionInvalid happens before any mutation.
    assert!(matches!(
        result,
        Err(skillforge_lib::error::AppError::DistributionInvalid(message))
            if message.contains("符号链接目标不是 SkillForge 来源")
    ));
    assert!(symlink.exists() || symlink.symlink_metadata().is_ok());
}

// ── remove_distributed 契约（33 号 3.3 / DEC-1，A6 后端部分）────────

// 契约 1：请求校验 —— scope=project 无 project_id → Err
#[test]
fn remove_distributed_rejects_project_scope_without_project_id() {
    let conn = init_db();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(
        support::TestPlatformPlugin::new("test-plat", "Test Platform"),
    )];
    let err = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "project",
        None,
        &["s1".to_string()],
        &[],
    )
    .unwrap_err();
    assert!(matches!(
        err,
        skillforge_lib::error::AppError::DistributionInvalid(_)
    ));
}

// 契约 2：fail-closed —— 请求移除一个「不再受管/不存在」的技能 → 整体拒绝、无任何删除
#[test]
fn remove_distributed_fails_closed_when_target_not_managed() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap();
    // 捕获路径句柄后再装箱（TestPlatformPlugin 非 Clone，装箱后无法再借用）
    let skills_dir = plugin.skills_dir();
    std::os::unix::fs::symlink(&source, skills_dir.join("managed-skill")).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    // 请求存在但未受管（磁盘无 symlink）的技能 → fail-closed 拒绝
    let err = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
        &["ghost-skill".to_string()],
        &[],
    )
    .unwrap_err();
    assert!(matches!(
        err,
        skillforge_lib::error::AppError::DistributionInvalid(_)
    ));
    // 受管 symlink 仍存在（未被删除）
    assert!(skills_dir.join("managed-skill").symlink_metadata().is_ok());
}

// 契约 3：所有权校验 —— symlink 指向非来源 → fail-closed 拒绝
#[test]
fn remove_distributed_rejects_symlink_not_pointing_at_source() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::new("test-plat", "Test Platform");
    insert_skill(&conn, &plugin, "managed-skill");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    // 构造 symlink → /somewhere/else（非 SkillForge 来源）
    let foreign = plugin.skills_dir().join("foreign-target");
    std::fs::create_dir_all(&foreign).unwrap();
    // 捕获路径句柄后再装箱（TestPlatformPlugin 非 Clone，装箱后无法再借用）
    let skills_dir = plugin.skills_dir();
    std::os::unix::fs::symlink(&foreign, skills_dir.join("managed-skill")).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let err = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
        &["managed-skill".to_string()],
        &[],
    )
    .unwrap_err();
    assert!(matches!(
        err,
        skillforge_lib::error::AppError::DistributionInvalid(_)
    ));
    // 文件保持原状
    assert!(skills_dir.join("managed-skill").symlink_metadata().is_ok());
}

// 契约 4：正常移除 —— 受管技能 + Directory 规则均被移除，removed 记录 id，errors 为空
#[test]
fn remove_distributed_removes_managed_skill_and_directory_rule() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_skill(&conn, &plugin, "managed-skill");
    insert_rule(&conn, "managed-rule", "managed content");
    std::fs::create_dir_all(plugin.skills_dir()).unwrap();
    let source = conn
        .query_row(
            "SELECT local_path FROM skills WHERE id = 'managed-skill'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap();
    // 捕获路径句柄后再装箱（TestPlatformPlugin 非 Clone，装箱后无法再借用）
    let skills_dir = plugin.skills_dir();
    let rules_dir = plugin.rules_dir();
    std::os::unix::fs::symlink(&source, skills_dir.join("managed-skill")).unwrap();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("managed-rule.md"), "managed content").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
        &["managed-skill".to_string()],
        &["managed-rule".to_string()],
    )
    .expect("移除受管内容应成功");
    // 规则格式按 remove_selected_rules 语义：rule:<id>
    assert_eq!(
        result.removed,
        vec!["managed-skill".to_string(), "rule:managed-rule".to_string()]
    );
    assert!(result.errors.is_empty());
    // 磁盘上 symlink 消失、规则文件消失
    assert!(skills_dir.join("managed-skill").symlink_metadata().is_err());
    assert!(!rules_dir.join("managed-rule.md").exists());
}

// 契约 5：SingleFile 规则移除 —— 标记块被移除、块外用户内容保留
#[test]
fn remove_distributed_removes_single_file_rule_block_preserving_user_content() {
    let conn = init_db();
    let plugin =
        support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", true, "AGENTS.md");
    insert_rule(&conn, "rule-1", "content-1");
    // 捕获路径句柄后再装箱（TestPlatformPlugin 非 Clone，装箱后无法再借用）
    let rules_file = plugin.rules_file();
    std::fs::create_dir_all(rules_file.parent().unwrap()).unwrap();
    std::fs::write(
        &rules_file,
        "# 用户保留内容\n\n<!-- SKILLFORGE:rule:rule-1 -->\ncontent-1\n<!-- /SKILLFORGE:rule:rule-1 -->\n\n末尾用户内容\n",
    )
    .unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    let result = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
        &[],
        &["rule-1".to_string()],
    )
    .expect("移除 SingleFile 规则应成功");
    assert_eq!(result.removed, vec!["rule:rule-1".to_string()]);
    assert!(result.errors.is_empty());
    let remaining = std::fs::read_to_string(&rules_file).unwrap();
    // 块外用户内容保留
    assert!(remaining.contains("# 用户保留内容"));
    assert!(remaining.contains("末尾用户内容"));
    // 标记块被移除
    assert!(!remaining.contains("SKILLFORGE:rule:rule-1"));
}

// ── 走查修复 F1：类型安全的 fail-closed 预检（技能/规则各自命名空间）────

// 同 ID 碰撞：技能 'shared' 受管、规则 'shared' 未受管 —— 技能不得掩盖缺失的规则
#[test]
fn remove_distributed_does_not_let_skill_id_hide_missing_rule_id() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_skill(&conn, &plugin, "shared");
    insert_rule(&conn, "shared", "content-shared");
    let skills_dir = plugin.skills_dir();
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(&skills_dir).unwrap();
    let source = conn
        .query_row("SELECT local_path FROM skills WHERE id = 'shared'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap();
    std::os::unix::fs::symlink(&source, skills_dir.join("shared")).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    // 规则 'shared' 从未分发（磁盘无文件）→ 不在 rules_to_remove → 整体拒绝
    let err = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
        &["shared".to_string()],
        &["shared".to_string()],
    )
    .unwrap_err();
    assert!(matches!(
        err,
        skillforge_lib::error::AppError::DistributionInvalid(_)
    ));
    // 技能 symlink 未被删除（fail-closed 整体拒绝）
    assert!(skills_dir.join("shared").symlink_metadata().is_ok());
    assert!(!rules_dir.join("shared.md").exists());
}

// 同 ID 碰撞：规则 'shared' 受管、技能 'shared' 未受管 —— 规则不得掩盖缺失的技能
#[test]
fn remove_distributed_does_not_let_rule_id_hide_missing_skill_id() {
    let conn = init_db();
    let plugin = support::TestPlatformPlugin::with_rules("test-plat", "Test Platform", false, "");
    insert_skill(&conn, &plugin, "shared");
    insert_rule(&conn, "shared", "content-shared");
    let skills_dir = plugin.skills_dir();
    let rules_dir = plugin.rules_dir();
    std::fs::create_dir_all(&rules_dir).unwrap();
    std::fs::write(rules_dir.join("shared.md"), "content-shared").unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plugin)];

    // 技能 'shared' 从未分发（磁盘无 symlink）→ 不在 skills_to_remove → 整体拒绝
    let err = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["test-plat".to_string()],
        "global",
        None,
        &["shared".to_string()],
        &["shared".to_string()],
    )
    .unwrap_err();
    assert!(matches!(
        err,
        skillforge_lib::error::AppError::DistributionInvalid(_)
    ));
    // 规则文件未被删除（fail-closed 整体拒绝）
    assert!(rules_dir.join("shared.md").exists());
    assert!(skills_dir.join("shared").symlink_metadata().is_err());
}

// 多平台子集语义：选中项只需在至少一个目标平台受管即可移除（managed-state
// 选择是扁平 id 列表，某项可能只在请求平台的一个子集上受管）
#[test]
fn remove_distributed_removes_from_subset_of_requested_platforms() {
    let conn = init_db();
    let plat_a = support::TestPlatformPlugin::new("plat-a", "Platform A");
    let plat_b = support::TestPlatformPlugin::new("plat-b", "Platform B");
    insert_skill(&conn, &plat_a, "s-a");
    let plat_a_skills_dir = plat_a.skills_dir();
    let plat_b_skills_dir = plat_b.skills_dir();
    std::fs::create_dir_all(&plat_a_skills_dir).unwrap();
    std::fs::create_dir_all(&plat_b_skills_dir).unwrap();
    let source = conn
        .query_row("SELECT local_path FROM skills WHERE id = 's-a'", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap();
    std::os::unix::fs::symlink(&source, plat_a_skills_dir.join("s-a")).unwrap();
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plat_a), Box::new(plat_b)];

    let result = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["plat-a".to_string(), "plat-b".to_string()],
        "global",
        None,
        &["s-a".to_string()],
        &[],
    )
    .expect("子集受管应成功移除");
    assert_eq!(result.removed, vec!["s-a".to_string()]);
    assert!(result.errors.is_empty());
    // 仅在受管的 plat-a 上删除；plat-b 从未持有该技能，无操作、无错误
    assert!(plat_a_skills_dir.join("s-a").symlink_metadata().is_err());
    assert!(plat_b_skills_dir.join("s-a").symlink_metadata().is_err());
}

// 多平台目标变化：请求平台全部缺失该技能 → fail-closed 整体拒绝
#[test]
fn remove_distributed_fails_closed_when_absent_from_all_platforms() {
    let conn = init_db();
    let plat_a = support::TestPlatformPlugin::new("plat-a", "Platform A");
    let plat_b = support::TestPlatformPlugin::new("plat-b", "Platform B");
    let plugins: Vec<Box<dyn PlatformPlugin>> = vec![Box::new(plat_a), Box::new(plat_b)];

    let err = skillforge_lib::engine::dist_execute::execute_remove_distributed(
        &conn,
        &plugins,
        &["plat-a".to_string(), "plat-b".to_string()],
        "global",
        None,
        &["ghost-skill".to_string()],
        &[],
    )
    .unwrap_err();
    assert!(matches!(
        err,
        skillforge_lib::error::AppError::DistributionInvalid(_)
    ));
}
