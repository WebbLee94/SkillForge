//! 29 号 2b：`reveal_path` 纯解析逻辑。
//! 1. tilde 展开（~ → $HOME）；2. as_skills_dir=true 时主目录推导（skills 子目录 → 父目录）；
//! 3. 目标不存在时沿父链取最近存在祖先（fallback=true）。
//!
//! opener 调用可注入，便于集成测试模拟系统调用成功/失败。

use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::types::RevealPathResult;

/// 展开 `~` / `~/` 前缀为用户主目录；非 ~ 开头原样返回（不做其他归一化）。
pub fn expand_tilde(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

/// 解析最终揭示目标，返回 `(最终路径, 是否发生祖先回退)`。
/// 全部祖先均不存在（理论上仅根目录缺失）时返回 None，由调用方转 Err。
pub fn resolve_reveal_target(path: &str, as_skills_dir: bool) -> Option<(PathBuf, bool)> {
    let expanded = expand_tilde(path);
    let candidate = if as_skills_dir {
        expanded
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| expanded.clone())
    } else {
        expanded
    };
    let mut current: &Path = &candidate;
    loop {
        if current.exists() {
            let fallback = current != candidate;
            return Some((current.to_path_buf(), fallback));
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => return None,
        }
    }
}

/// 带可注入 opener 的完整 reveal 执行；`open` 返回 Err（系统调用失败）→ 命令返回 Err。
pub fn reveal_path_with_opener<F>(
    path: &str,
    as_skills_dir: bool,
    open: F,
) -> Result<RevealPathResult, AppError>
where
    F: Fn(&Path) -> Result<(), String>,
{
    let (target, fallback) = resolve_reveal_target(path, as_skills_dir)
        .ok_or_else(|| AppError::Io("目标目录不存在或无法打开".to_string()))?;
    open(&target).map_err(|e| AppError::Io(format!("无法打开目标目录: {e}")))?;
    Ok(RevealPathResult {
        revealed_path: target.to_string_lossy().to_string(),
        fallback,
    })
}
