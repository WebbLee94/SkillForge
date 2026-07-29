use crate::engine::parser;
use crate::error::AppError;
use crate::types::{SkillBundle, SkillMeta, ValidationResult, VersionInfo};

use super::SourcePlugin;

/// Git repository source plugin.
/// Clones a git repo to a local cache and scans for SKILL.md files.
pub struct GitRepoSource {
    cache_dir: std::path::PathBuf,
}

impl GitRepoSource {
    pub fn new() -> Self {
        let cache_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".skillforge")
            .join("cache")
            .join("git");
        Self { cache_dir }
    }

    pub fn with_cache_dir(cache_dir: std::path::PathBuf) -> Self {
        Self { cache_dir }
    }

    /// Create with a specific repo URL as cache base (for update operations)
    pub fn with_url(_url: String) -> Self {
        // For git-repo updates, we still use the default cache dir
        // The actual repo URL is resolved from the skill's source_url in DB
        Self::new()
    }

    /// Compute a cache directory name from a repo URL
    fn repo_cache_name(url: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let hash = hasher.finalize();
        format!("{:x}", hash)[..16].to_string()
    }

    /// Clone or update a git repository to the local cache
    fn ensure_repo(&self, url: &str) -> Result<std::path::PathBuf, AppError> {
        let cache_name = Self::repo_cache_name(url);
        let repo_path = self.cache_dir.join(&cache_name);

        if repo_path.exists() {
            // Pull latest changes
            let repo = git2::Repository::open(&repo_path)
                .map_err(|e| AppError::Source(format!("打开仓库失败: {}", e)))?;
            let mut remote = repo
                .find_remote("origin")
                .or_else(|_| repo.remote_anonymous(url))
                .map_err(|e| AppError::Source(format!("查找远程仓库失败: {}", e)))?;
            remote
                .fetch(&["refs/heads/*:refs/remotes/origin/*"], None, None)
                .map_err(|e| AppError::Source(format!("拉取远程更新失败: {}", e)))?;
        } else {
            // Clone the repository
            std::fs::create_dir_all(&self.cache_dir)?;
            git2::Repository::clone(url, &repo_path)
                .map_err(|e| AppError::Source(format!("克隆仓库失败: {}", e)))?;
        }

        Ok(repo_path)
    }
}

impl Default for GitRepoSource {
    fn default() -> Self {
        Self::new()
    }
}

impl SourcePlugin for GitRepoSource {
    fn name(&self) -> &'static str {
        "git-repo"
    }

    fn display_name(&self) -> &'static str {
        "Git Repository"
    }

    fn list_skills(&self) -> Result<Vec<SkillMeta>, AppError> {
        // GitRepoSource requires a URL to list skills; cannot list without one.
        // This method returns an empty list; use fetch with a specific URL instead.
        Ok(vec![])
    }

    fn fetch(&self, skill_id: &str, _version: Option<&str>) -> Result<SkillBundle, AppError> {
        // skill_id for git-repo is expected to be in format: "repo_url#skill_name"
        // e.g., "https://github.com/example/skills.git#java-springboot"
        let parts: Vec<&str> = skill_id.splitn(2, '#').collect();
        if parts.len() != 2 {
            return Err(AppError::Source(
                "Git 仓库 skill_id 格式必须为: repo_url#skill_name".to_string(),
            ));
        }

        let repo_url = parts[0];
        let skill_name = parts[1];

        let repo_path = self.ensure_repo(repo_url)?;
        let skill_dir = repo_path.join(skill_name);

        if !skill_dir.exists() {
            return Err(AppError::SkillNotFound(format!(
                "仓库中未找到技能 '{}'",
                skill_name
            )));
        }

        let skill_md_path = skill_dir.join("SKILL.md");
        let content = std::fs::read_to_string(&skill_md_path)
            .map_err(|e| AppError::Source(format!("读取 SKILL.md 失败: {}", e)))?;

        let mut bundle = parser::parse_skill_md(&content)?;
        bundle.meta.source_type = "git-repo".to_string();
        bundle.meta.source_url = Some(repo_url.to_string());

        // Detect subdirectories
        let known_subdirs = ["references", "scripts", "rules", "assets", "examples"];
        for subdir in &known_subdirs {
            let subdir_path = skill_dir.join(subdir);
            if subdir_path.exists() && subdir_path.is_dir() {
                if !bundle.subdirs.contains(&subdir.to_string()) {
                    bundle.subdirs.push(subdir.to_string());
                }
            }
        }

        Ok(bundle)
    }

    fn get_versions(&self, skill_id: &str) -> Result<Vec<VersionInfo>, AppError> {
        let parts: Vec<&str> = skill_id.splitn(2, '#').collect();
        if parts.len() != 2 {
            return Err(AppError::Source(
                "Git 仓库 skill_id 格式必须为: repo_url#skill_name".to_string(),
            ));
        }

        let repo_url = parts[0];
        let skill_name = parts[1];
        let repo_path = self.ensure_repo(repo_url)?;

        let repo = git2::Repository::open(&repo_path)
            .map_err(|e| AppError::Source(format!("打开仓库失败: {}", e)))?;

        let mut versions = Vec::new();

        // Get tags that match the skill name
        repo.tag_foreach(|oid, name| {
            let tag_name = String::from_utf8_lossy(name);
            let tag_str = tag_name.trim_start_matches("refs/tags/");

            // Tags in format: {skill_name}/v1.0.0 or {skill_name}-v1.0.0
            if tag_str.starts_with(skill_name) {
                let version = tag_str
                    .trim_start_matches(skill_name)
                    .trim_start_matches('/')
                    .trim_start_matches('-')
                    .to_string();

                if let Ok(_target) = repo.find_commit(oid) {
                    versions.push(VersionInfo {
                        version,
                        source_ref: Some(oid.to_string()),
                        checksum: None,
                        fetched_at: chrono::Utc::now().to_rfc3339(),
                    });
                }
            }
            true
        })
        .map_err(|e| AppError::Source(format!("列出标签失败: {}", e)))?;

        // If no tagged versions, return HEAD as "latest"
        if versions.is_empty() {
            let head = repo
                .head()
                .map_err(|e| AppError::Source(format!("获取 HEAD 失败: {}", e)))?;
            let target = head
                .target()
                .ok_or_else(|| AppError::Source("无 HEAD 目标".to_string()))?;

            versions.push(VersionInfo {
                version: "latest".to_string(),
                source_ref: Some(target.to_string()),
                checksum: None,
                fetched_at: chrono::Utc::now().to_rfc3339(),
            });
        }

        Ok(versions)
    }

    fn validate(&self, skill_id: &str) -> Result<ValidationResult, AppError> {
        let parts: Vec<&str> = skill_id.splitn(2, '#').collect();
        if parts.len() != 2 {
            return Ok(ValidationResult {
                valid: false,
                errors: vec!["Git 仓库 skill_id 格式必须为: repo_url#skill_name".to_string()],
            });
        }

        let repo_url = parts[0];
        let skill_name = parts[1];

        match self.ensure_repo(repo_url) {
            Ok(repo_path) => {
                let skill_dir = repo_path.join(skill_name);
                if !skill_dir.exists() {
                    return Ok(ValidationResult {
                        valid: false,
                        errors: vec![format!("仓库中未找到技能 '{}'", skill_name)],
                    });
                }

                let skill_md_path = skill_dir.join("SKILL.md");
                if !skill_md_path.exists() {
                    return Ok(ValidationResult {
                        valid: false,
                        errors: vec![format!("'{}' 未找到 SKILL.md", skill_name)],
                    });
                }

                let content = std::fs::read_to_string(&skill_md_path)?;
                match parser::parse_skill_md(&content) {
                    Ok(_) => Ok(ValidationResult {
                        valid: true,
                        errors: vec![],
                    }),
                    Err(e) => Ok(ValidationResult {
                        valid: false,
                        errors: vec![e.to_string()],
                    }),
                }
            }
            Err(e) => Ok(ValidationResult {
                valid: false,
                errors: vec![format!("访问仓库失败: {}", e)],
            }),
        }
    }
}
