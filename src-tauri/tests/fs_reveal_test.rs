//! 29 号 2b：reveal_path 契约测试。
//! tilde 展开 + skills 子目录→主目录推导 + 最近存在祖先回退 + opener 失败传播。
//! 与既有集成测试一致：通过 `skillforge_lib::fs_reveal` 公开 API 断言。

use skillforge_lib::fs_reveal::{expand_tilde, resolve_reveal_target, reveal_path_with_opener};
use std::path::PathBuf;

#[test]
fn expand_tilde_expands_home_prefix() {
    let home = dirs::home_dir().expect("HOME 存在");
    assert_eq!(expand_tilde("~/.trae-cn/skills"), home.join(".trae-cn/skills"));
    assert_eq!(expand_tilde("~/nonexistent-sf-test"), home.join("nonexistent-sf-test"));
    assert_eq!(expand_tilde("~"), home);
    // 非 ~ 开头原样使用，不做其他归一化
    assert_eq!(expand_tilde("/tmp/plain/path"), PathBuf::from("/tmp/plain/path"));
}

#[test]
fn derive_main_dir_from_skills_subdir() {
    let tmp = tempfile::tempdir().unwrap();
    let main = tmp.path().join(".trae-cn");
    std::fs::create_dir_all(&main).unwrap();
    let skills = main.join("skills");
    std::fs::create_dir_all(&skills).unwrap();

    // as_skills_dir = true → 目标主目录 = skills 的父目录
    let (resolved, fallback) =
        resolve_reveal_target(&skills.to_string_lossy(), true).expect("可解析");
    assert_eq!(resolved, main);
    assert!(!fallback);

    // as_skills_dir = false → 目标主目录 = 路径本身
    let (resolved2, fallback2) =
        resolve_reveal_target(&skills.to_string_lossy(), false).expect("可解析");
    assert_eq!(resolved2, skills);
    assert!(!fallback2);
}

#[test]
fn falls_back_to_nearest_existing_ancestor() {
    let tmp = tempfile::tempdir().unwrap();
    let deep = tmp.path().join("a").join("b").join("c");
    std::fs::create_dir_all(&deep).unwrap();
    let missing = deep.join("d").join("e"); // 不存在

    let (resolved, fallback) =
        resolve_reveal_target(&missing.to_string_lossy(), false).expect("可解析");
    assert_eq!(resolved, deep);
    assert!(fallback);
}

#[test]
fn opens_existing_path_directly() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("a");
    std::fs::create_dir_all(&dir).unwrap();

    let (resolved, fallback) =
        resolve_reveal_target(&dir.to_string_lossy(), false).expect("可解析");
    assert_eq!(resolved, dir);
    assert!(!fallback);
}

#[test]
fn tilde_nonexistent_target_falls_back_to_home() {
    // "~/nonexistent-sf-test" 不存在 → 最近存在祖先 = $HOME（fallback=true）
    let (resolved, fallback) =
        resolve_reveal_target("~/nonexistent-sf-test", false).expect("可解析");
    assert_eq!(resolved, dirs::home_dir().unwrap());
    assert!(fallback);
}

#[test]
fn opener_error_propagates_as_err_and_success_returns_flag() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("a");
    std::fs::create_dir_all(&dir).unwrap();

    // mock opener 返回 Err → 命令返回 Err
    let err = reveal_path_with_opener(&dir.to_string_lossy(), false, |_| {
        Err("opener boom".to_string())
    });
    assert!(err.is_err());

    // 正常 opener → Ok，且携带 fallback 标记
    let ok = reveal_path_with_opener(&dir.to_string_lossy(), false, |p| {
        assert_eq!(p, dir.as_path());
        Ok(())
    });
    assert!(ok.is_ok());
    let result = ok.unwrap();
    assert!(!result.fallback);
    assert_eq!(result.revealed_path, dir.to_string_lossy());
}
