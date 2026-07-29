//! Filesystem watcher using notify crate.
//! Monitors skill/rule directories across 12 platforms for external changes.
//! Implements self-write mute mechanism to suppress echo of own sync operations.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Runtime};

static PENDING_EVENTS: OnceLock<Mutex<Vec<PendingEvent>>> = OnceLock::new();

#[derive(Clone)]
struct PendingEvent {
    id: u64,
    event_type: String,
    path: String,
}

static EVENT_COUNTER: OnceLock<Mutex<u64>> = OnceLock::new();

// ── Constants ──
const APP_FS_CHANGED_EVENT: &str = "app-fs-changed";
const WATCH_RESCAN_INTERVAL: Duration = Duration::from_secs(3);
const WATCH_EMIT_DEBOUNCE: Duration = Duration::from_millis(500);
const SELF_WRITE_MUTE: Duration = Duration::from_millis(1200);
const STARTUP_COOLDOWN: Duration = Duration::from_secs(2);

// ── Mute State ──
static MUTE_STATE: OnceLock<Mutex<MuteState>> = OnceLock::new();
static EPOCH: OnceLock<Instant> = OnceLock::new();

#[derive(Default)]
struct MuteState {
    deadline_ms: u64,
    roots: Vec<PathBuf>,
}

fn mute_state() -> &'static Mutex<MuteState> {
    MUTE_STATE.get_or_init(|| Mutex::new(MuteState::default()))
}

fn now_ms() -> u64 {
    EPOCH.get_or_init(Instant::now).elapsed().as_millis() as u64
}

// ── Pure predicates (unit-testable) ──
fn muted_at(now_ms: u64, suppress_until_ms: u64) -> bool {
    now_ms < suppress_until_ms
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum MuteVerdict {
    Live,
    SelfWrite,
    Foreign,
}

fn classify_mute(
    now_ms: u64,
    deadline_ms: u64,
    roots: &[PathBuf],
    event_paths: &[PathBuf],
) -> MuteVerdict {
    if !muted_at(now_ms, deadline_ms) {
        return MuteVerdict::Live;
    }
    if !event_paths.is_empty()
        && event_paths
            .iter()
            .all(|p| roots.iter().any(|r| p.starts_with(r)))
    {
        MuteVerdict::SelfWrite
    } else {
        MuteVerdict::Foreign
    }
}

fn classify_event_paths(event_paths: &[PathBuf]) -> MuteVerdict {
    let state = mute_state().lock().unwrap();
    classify_mute(now_ms(), state.deadline_ms, &state.roots, event_paths)
}

// ── Emit decision ──
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum EmitAction {
    Emit,
    Defer,
    Skip,
}

fn decide_emit(relevant: bool, mute: MuteVerdict, debounced: bool) -> EmitAction {
    if !relevant {
        return EmitAction::Skip;
    }
    match mute {
        MuteVerdict::SelfWrite => EmitAction::Skip,
        MuteVerdict::Foreign => EmitAction::Defer,
        MuteVerdict::Live => {
            if debounced {
                EmitAction::Skip
            } else {
                EmitAction::Emit
            }
        }
    }
}

// ── Public API ──
pub fn mute_self_writes(target: &Path) {
    let now = now_ms();
    let mut state = mute_state().lock().unwrap();
    if !muted_at(now, state.deadline_ms) {
        state.roots.clear();
    }
    state.deadline_ms = state
        .deadline_ms
        .max(now + SELF_WRITE_MUTE.as_millis() as u64);
    if !state.roots.iter().any(|r| target.starts_with(r)) {
        state.roots.push(target.to_path_buf());
    }
}

fn self_write_muted() -> bool {
    muted_at(now_ms(), mute_state().lock().unwrap().deadline_ms)
}

// ── Watch path collection ──
pub fn collect_watch_paths(_conn: &rusqlite::Connection) -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    // Only watch platform global directories. Central repository (~/.skillforge/skills/)
    // is managed by SkillForge itself and does not need external change monitoring.
    let mut paths = Vec::new();
    let platforms = [
        ".claude",
        ".opencode",
        ".cursor",
        ".trae",
        ".trae-cn",
        ".codebuddy",
        ".codebuddy-cn",
        ".codex",
        ".windsurf",
        ".hermes",
        ".openclaw",
        ".antigravity",
    ];
    for p in &platforms {
        paths.push(home.join(p).join("skills"));
        paths.push(home.join(p).join("rules"));
        paths.push(home.join(p).join("rules.md"));
    }
    paths.sort();
    paths.dedup();
    paths
}

// ── Watch set sync ──
fn sync_watch_set(
    watcher: &mut RecommendedWatcher,
    watched: &mut HashSet<PathBuf>,
    desired: &HashSet<PathBuf>,
) -> bool {
    let mut changed = false;
    for stale in watched.difference(desired).cloned().collect::<Vec<_>>() {
        let _ = watcher.unwatch(&stale);
        watched.remove(&stale);
        changed = true;
    }
    for path in desired {
        if watched.contains(path) {
            continue;
        }
        if let Ok(()) = watcher.watch(path, RecursiveMode::Recursive) {
            watched.insert(path.clone());
            changed = true;
        }
    }
    changed
}

fn should_emit(event: &Event) -> bool {
    if event.paths.is_empty() {
        return false;
    }
    event.paths.iter().any(|p| !is_in_git_dir(p))
}

fn is_in_git_dir(path: &Path) -> bool {
    path.components()
        .any(|c| c.as_os_str() == std::ffi::OsStr::new(".git"))
}

fn is_skill_related(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    // Skip noise files
    if name == ".DS_Store" || name == "Thumbs.db" {
        return false;
    }
    if name == "__pycache__" || name.ends_with(".pyc") {
        return false;
    }
    if name.starts_with(".git") {
        return false;
    }
    if name.starts_with("._") {
        return false;
    }
    // Skip empty file names (parent-dir-only events)
    if name.is_empty() {
        return false;
    }

    true
}

// ── Main watcher loop ──
pub fn start_file_watcher<R: Runtime>(app: AppHandle<R>, watch_paths: Vec<PathBuf>) {
    let watch_paths = Arc::new(watch_paths);
    PENDING_EVENTS.get_or_init(|| Mutex::new(Vec::new()));
    EVENT_COUNTER.get_or_init(|| Mutex::new(0));

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match RecommendedWatcher::new(
            move |result| {
                let _ = tx.send(result);
            },
            Config::default().with_poll_interval(Duration::from_secs(2)),
        ) {
            Ok(w) => w,
            Err(e) => {
                log::error!("无法创建文件监控器: {e}");
                return;
            }
        };

        let mut watched = HashSet::new();
        let mut last_sync = Instant::now() - WATCH_RESCAN_INTERVAL;
        let mut last_emit = Instant::now() - WATCH_EMIT_DEBOUNCE;
        let mut pending_emit = false;
        let startup = Instant::now();

        let emit_now = |le: &mut Instant, pend: &mut bool| {
            if startup.elapsed() < STARTUP_COOLDOWN {
                *pend = true;
                return;
            }
            if app.emit(APP_FS_CHANGED_EVENT, ()).is_err() {
                log::debug!("无法发送 app-fs-changed 事件");
            }
            *le = Instant::now();
        };

        let classify_kind = |kind: &EventKind| -> &'static str {
            match kind {
                EventKind::Create(_) => "NEW",
                EventKind::Remove(_) => "DELETED",
                EventKind::Modify(_) => "MODIFIED",
                _ => "MODIFIED",
            }
        };

        loop {
            if last_sync.elapsed() >= WATCH_RESCAN_INTERVAL {
                let paths: HashSet<PathBuf> = watch_paths.iter().cloned().collect();
                let changed = sync_watch_set(&mut watcher, &mut watched, &paths);
                match decide_emit(
                    changed,
                    classify_event_paths(&[]),
                    last_emit.elapsed() < WATCH_EMIT_DEBOUNCE,
                ) {
                    EmitAction::Emit => emit_now(&mut last_emit, &mut pending_emit),
                    EmitAction::Defer => pending_emit = true,
                    EmitAction::Skip => {}
                }
                last_sync = Instant::now();
            }

            if pending_emit && !self_write_muted() && last_emit.elapsed() >= WATCH_EMIT_DEBOUNCE {
                pending_emit = false;
                emit_now(&mut last_emit, &mut pending_emit);
            }

            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(event)) => {
                    log::info!("Watcher: 检测到文件变更 {:?}", &event.paths);
                    let kind = classify_kind(&event.kind);
                    let mut roots: HashSet<PathBuf> = HashSet::new();
                    for path in &event.paths {
                        if !is_skill_related(path) {
                            continue;
                        }
                        if let Some(root) = resolve_to_skill_root(path) {
                            roots.insert(root);
                        }
                    }
                    if !roots.is_empty() {
                        let mut events = PENDING_EVENTS.get().unwrap().lock().unwrap();
                        for root in roots {
                            let root_str = root.to_string_lossy().to_string();
                            if resolve_path_inline(&root_str).is_none() {
                                continue;
                            }
                            if kind == "MODIFIED"
                                && events
                                    .iter()
                                    .any(|e| e.path == root_str && e.event_type == "NEW")
                            {
                                continue;
                            }
                            if events
                                .iter()
                                .any(|e| e.path == root_str && e.event_type == kind)
                            {
                                continue;
                            }
                            let id = {
                                let mut counter = EVENT_COUNTER.get().unwrap().lock().unwrap();
                                *counter += 1;
                                *counter
                            };
                            events.push(PendingEvent {
                                id,
                                event_type: kind.to_string(),
                                path: root_str,
                            });
                        }
                    }
                    match decide_emit(
                        should_emit(&event),
                        classify_event_paths(&event.paths),
                        last_emit.elapsed() < WATCH_EMIT_DEBOUNCE,
                    ) {
                        EmitAction::Emit => emit_now(&mut last_emit, &mut pending_emit),
                        EmitAction::Defer => pending_emit = true,
                        EmitAction::Skip => {}
                    }
                }
                Ok(Err(e)) => log::debug!("监控器错误: {e}"),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

pub fn get_pending_events() -> Vec<(u64, String, String)> {
    let events = PENDING_EVENTS
        .get()
        .map(|m| m.lock().unwrap().clone())
        .unwrap_or_default();
    events
        .into_iter()
        .map(|e| (e.id, e.event_type, e.path))
        .collect()
}

pub fn clear_pending_events() {
    if let Some(m) = PENDING_EVENTS.get() {
        m.lock().unwrap().clear();
    }
}

fn resolve_path_inline(path_str: &str) -> Option<(String, String)> {
    crate::engine::watcher_integration::resolve_path_to_capability(std::path::Path::new(path_str))
}

fn resolve_to_skill_root(path: &Path) -> Option<PathBuf> {
    let components: Vec<_> = path.components().collect();
    for i in 0..components.len() {
        let name = components[i].as_os_str().to_str()?;
        if (name == "skills" || name == "rules") && i + 1 < components.len() {
            return Some(components[..=i + 1].iter().collect());
        }
    }
    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
        if name == "rules.md" {
            return Some(path.to_path_buf());
        }
    }
    None
}

pub fn build_watch_paths(enabled_platform_ids: &[String]) -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    let all: &[(&str, &str)] = &[
        ("claude-code", ".claude"),
        ("opencode", ".opencode"),
        ("cursor", ".cursor"),
        ("trae", ".trae"),
        ("trae-cn", ".trae-cn"),
        ("codebuddy", ".codebuddy"),
        ("codebuddy-cn", ".codebuddy-cn"),
        ("codex", ".codex"),
        ("windsurf", ".windsurf"),
        ("hermes", ".hermes"),
        ("openclaw", ".openclaw"),
        ("antigravity", ".antigravity"),
    ];
    let mut paths = Vec::new();
    for (id, dir) in all {
        if !enabled_platform_ids.iter().any(|e| e == id) {
            continue;
        }
        paths.push(home.join(dir).join("skills"));
        paths.push(home.join(dir).join("rules"));
        paths.push(home.join(dir).join("rules.md"));
    }
    paths.sort();
    paths.dedup();
    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn muted_at_half_open_boundary() {
        // Muted strictly before deadline
        assert!(muted_at(5, 10));
        // NOT muted at or after deadline
        assert!(!muted_at(10, 10));
        assert!(!muted_at(11, 10));
        // Zero deadline = never muted
        assert!(!muted_at(0, 0));
    }

    #[test]
    fn classify_mute_path_scoped() {
        let roots = vec![PathBuf::from("/agents/claude/skills/foo")];
        let inside = vec![PathBuf::from("/agents/claude/skills/foo/SKILL.md")];
        let outside = vec![PathBuf::from("/agents/codex/skills/bar/SKILL.md")];

        // Outside window → Live
        assert_eq!(classify_mute(10, 10, &roots, &inside), MuteVerdict::Live);
        // Inside window, all paths under root → SelfWrite
        assert_eq!(
            classify_mute(5, 10, &roots, &inside),
            MuteVerdict::SelfWrite
        );
        // Inside window, paths not under root → Foreign
        assert_eq!(classify_mute(5, 10, &roots, &outside), MuteVerdict::Foreign);
        // Empty paths (rescan) → Foreign (defer, don't drop)
        assert_eq!(classify_mute(5, 10, &roots, &[]), MuteVerdict::Foreign);
    }

    #[test]
    fn decide_emit_routing() {
        // SelfWrite → always Skip
        assert_eq!(
            decide_emit(true, MuteVerdict::SelfWrite, false),
            EmitAction::Skip
        );
        // Foreign → always Defer
        assert_eq!(
            decide_emit(true, MuteVerdict::Foreign, false),
            EmitAction::Defer
        );
        assert_eq!(
            decide_emit(true, MuteVerdict::Foreign, true),
            EmitAction::Defer
        );
        // Live + not debounced → Emit
        assert_eq!(
            decide_emit(true, MuteVerdict::Live, false),
            EmitAction::Emit
        );
        // Live + debounced → Skip
        assert_eq!(decide_emit(true, MuteVerdict::Live, true), EmitAction::Skip);
        // Irrelevant → always Skip
        assert_eq!(
            decide_emit(false, MuteVerdict::Foreign, false),
            EmitAction::Skip
        );
    }

    #[test]
    fn build_watch_paths_filters_by_enabled_platforms() {
        let all_ids: Vec<String> = [
            "claude-code",
            "opencode",
            "cursor",
            "trae",
            "trae-cn",
            "codebuddy",
            "codebuddy-cn",
            "codex",
            "windsurf",
            "hermes",
            "openclaw",
            "antigravity",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let paths = build_watch_paths(&all_ids);
        assert!(
            paths.len() >= 36,
            "expected >=36 paths, got {}",
            paths.len()
        );
        let home = dirs::home_dir().unwrap();
        assert!(paths.contains(&home.join(".claude").join("skills")));
        assert!(!paths.contains(&home.join(".skillforge").join("skills")));

        let few: Vec<String> = ["claude-code".to_string()].to_vec();
        let few_paths = build_watch_paths(&few);
        assert_eq!(few_paths.len(), 3);
    }
}
