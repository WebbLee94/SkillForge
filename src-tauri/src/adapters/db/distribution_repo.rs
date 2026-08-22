//! [`DistributionRepository`] 的 SQLite 直通实现，委托到 `engine/dist_plan` 既有查询。

use crate::engine::dist_plan;
use crate::error::AppError;
use crate::ports::distribution::DistributionRepository;
use crate::types::Skill;

/// 借用现有连接的 SQLite 仓储适配器（行为与原 engine 查询完全一致）。
pub struct SqliteDistributionRepository<'a> {
    conn: &'a rusqlite::Connection,
}

impl<'a> SqliteDistributionRepository<'a> {
    pub fn new(conn: &'a rusqlite::Connection) -> Self {
        Self { conn }
    }
}

impl DistributionRepository for SqliteDistributionRepository<'_> {
    fn get_skill(&self, skill_id: &str) -> Result<Skill, AppError> {
        dist_plan::get_skill(self.conn, skill_id)
    }

    fn get_project_path(&self, project_id: &str) -> Option<String> {
        dist_plan::get_project_path(self.conn, project_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema;
    use rusqlite::params;

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        schema::create_tables(&conn).unwrap();
        conn
    }

    #[test]
    fn get_skill_returns_inserted_row() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO skills (id, name, description, source_type, source_url, current_ver, installed_at, local_path, metadata)
             VALUES (?1, ?1, NULL, 'local', NULL, '1.0.0', ?2, '/tmp/skills/demo', NULL)",
            params!["demo", chrono::Utc::now().to_rfc3339()],
        )
        .unwrap();

        let repo = SqliteDistributionRepository::new(&conn);
        let skill = repo.get_skill("demo").unwrap();
        assert_eq!(skill.id, "demo");
        assert_eq!(skill.local_path, "/tmp/skills/demo");
    }

    #[test]
    fn get_skill_missing_fails_closed() {
        let conn = setup_db();
        let repo = SqliteDistributionRepository::new(&conn);
        let err = repo.get_skill("nope").unwrap_err();
        assert!(matches!(err, AppError::SkillNotFound(id) if id == "nope"));
    }

    #[test]
    fn get_project_path_some_and_none() {
        let conn = setup_db();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?1, ?1, ?2, NULL, ?3, ?3)",
            params!["p1", "/tmp/proj", now],
        )
        .unwrap();

        let repo = SqliteDistributionRepository::new(&conn);
        assert_eq!(
            repo.get_project_path("p1").as_deref(),
            Some("/tmp/proj")
        );
        assert_eq!(repo.get_project_path("missing"), None);
    }
}
