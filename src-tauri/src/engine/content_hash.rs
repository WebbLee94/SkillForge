//! SHA256 content hashing for skill/rule directories.
//! Produces deterministic fingerprints for change detection.
//! Ignores .git, .DS_Store, Thumbs.db, __pycache__, *.pyc.

use crate::error::AppError;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const IGNORED: &[&str] = &[
    ".git",
    ".DS_Store",
    "Thumbs.db",
    ".gitignore",
    "__pycache__",
];

fn is_ignored(name: &str) -> bool {
    IGNORED.contains(&name) || name.ends_with(".pyc")
}

pub struct ContentEntry {
    pub relative_path: String,
    pub path: PathBuf,
    pub modified_ms: Option<i64>,
}

pub fn list_content_files(dir: &Path) -> Vec<ContentEntry> {
    let mut entries: Vec<_> = WalkDir::new(dir)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !is_ignored(&name)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .collect();

    entries.sort_by(|a, b| a.path().cmp(b.path()));

    entries
        .into_iter()
        .map(|entry| {
            let relative_path = entry
                .path()
                .strip_prefix(dir)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .into_owned();
            let modified_ms = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64);
            ContentEntry {
                relative_path,
                path: entry.into_path(),
                modified_ms,
            }
        })
        .collect()
}

pub fn hash_directory(dir: &Path) -> Result<String, AppError> {
    let entries = list_content_files(dir);
    Ok(hash_entries(&entries))
}

pub fn hash_file(path: &Path) -> Result<String, AppError> {
    let content = std::fs::read(path)
        .map_err(|e| AppError::Io(format!("Failed to read {:?}: {}", path, e)))?;
    let mut hasher = Sha256::new();
    hasher.update(&content);
    Ok(hex::encode(hasher.finalize()))
}

/// SHA-256 hex of the UTF-8 bytes of `text`.
pub fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// 规则内容比较的规范化：容忍恰好一个尾部换行
/// （与 SingleFile 托管块渲染器写入的 `{content}\n` 及
/// [`crate::domain::distribution::policy::managed_block_content_matches`]
/// 的匹配语义保持一致）。
pub fn canonical_rule_text(text: &str) -> &str {
    text.strip_suffix('\n').unwrap_or(text)
}

pub fn rule_content_digest(content: &str) -> String {
    hash_text(canonical_rule_text(content))
}

fn hash_entries(entries: &[ContentEntry]) -> String {
    let mut hasher = Sha256::new();
    for entry in entries {
        hasher.update(entry.relative_path.as_bytes());
        if let Ok(content) = std::fs::read(&entry.path) {
            hasher.update(&content);
        }
    }
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Same content → same hash, deterministic across calls
    #[test]
    fn hash_deterministic_same_content() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("SKILL.md"), "---\nname: test\n---\n# hello").unwrap();
        std::fs::write(tmp.path().join("helper.py"), "print('hi')").unwrap();

        let h1 = hash_directory(tmp.path()).unwrap();
        let h2 = hash_directory(tmp.path()).unwrap();
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64); // SHA256 hex is 64 chars
    }

    /// .git, .DS_Store are excluded from hash calculation
    #[test]
    fn hash_ignores_dot_git_and_ds_store() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("SKILL.md"), "# hello").unwrap();
        let h1 = hash_directory(tmp.path()).unwrap();

        std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
        std::fs::write(tmp.path().join(".git/config"), "git data").unwrap();
        std::fs::write(tmp.path().join(".DS_Store"), "binary").unwrap();
        let h2 = hash_directory(tmp.path()).unwrap();

        assert_eq!(h1, h2);
    }

    /// hash_file is deterministic for same file content
    #[test]
    fn hash_file_same_content_same_hash() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("test.md");
        std::fs::write(&path, "hello world").unwrap();
        let h1 = hash_file(&path).unwrap();
        let h2 = hash_file(&path).unwrap();
        assert_eq!(h1, h2);
    }

    /// list_content_files returns sorted entries, ignores .git
    #[test]
    fn list_content_files_sorted_and_ignores_dot_git() {
        let tmp = tempdir().unwrap();
        std::fs::write(tmp.path().join("b.txt"), "b").unwrap();
        std::fs::write(tmp.path().join("a.txt"), "a").unwrap();
        std::fs::create_dir_all(tmp.path().join(".git")).unwrap();
        std::fs::write(tmp.path().join(".git/config"), "x").unwrap();

        let entries = list_content_files(tmp.path());
        let names: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        assert_eq!(names, vec!["a.txt", "b.txt"]);
    }
}
