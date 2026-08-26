/// Compile-time constant definitions for all supported Agent platforms.
/// This is the single source of truth for platform metadata (paths, capabilities).
/// DB `platforms` table stores only mutable fields (enabled, icon).
use crate::types::{PlatformPaths as PlatformPathsType, RulesFormat};

/// Static platform definition — all data known at compile time.
pub struct PlatformDef {
    pub id: &'static str,
    pub name: &'static str,
    pub adapter: &'static str,
    pub skills_global: &'static str,
    pub skills_project: &'static str,
    pub rules_global: Option<&'static str>,
    pub rules_project: Option<&'static str>,
    /// If true, global rules use SingleFile format (file_name derived from rules_global path)
    pub rules_single_file_global: bool,
    /// If true, project rules use SingleFile format (file_name derived from rules_project path)
    pub rules_single_file_project: bool,
}

/// All supported platforms — the single source of truth.
pub const ALL_PLATFORMS: &[PlatformDef] = &[
    PlatformDef {
        id: "claude-code",
        name: "Claude Code",
        adapter: "claude-code",
        skills_global: "~/.claude/skills",
        skills_project: ".claude/skills",
        rules_global: Some("~/.claude/CLAUDE.md"),
        rules_project: Some("CLAUDE.md"),
        rules_single_file_global: true,
        rules_single_file_project: true,
    },
    PlatformDef {
        id: "opencode",
        name: "OpenCode",
        adapter: "opencode",
        skills_global: "~/.config/opencode/skills",
        skills_project: ".opencode/skills",
        rules_global: Some("~/.config/opencode/AGENTS.md"),
        rules_project: Some("AGENTS.md"),
        rules_single_file_global: true,
        rules_single_file_project: true,
    },
    PlatformDef {
        id: "cursor",
        name: "Cursor",
        adapter: "cursor",
        skills_global: "~/.cursor/skills",
        skills_project: ".cursor/skills",
        rules_global: Some("~/.cursor/rules"),
        rules_project: Some(".cursor/rules"),
        rules_single_file_global: false,
        rules_single_file_project: false,
    },
    PlatformDef {
        id: "trae",
        name: "Trae",
        adapter: "trae",
        skills_global: "~/.trae/skills",
        skills_project: ".trae/skills",
        rules_global: Some("~/.trae/user_rules"),
        rules_project: Some(".trae/rules"),
        rules_single_file_global: false,
        rules_single_file_project: false,
    },
    PlatformDef {
        id: "trae-cn",
        name: "Trae CN",
        adapter: "trae-cn",
        skills_global: "~/.trae-cn/skills",
        skills_project: ".trae/skills",
        rules_global: Some("~/.trae-cn/user_rules"),
        rules_project: Some(".trae/rules"),
        rules_single_file_global: false,
        rules_single_file_project: false,
    },
    PlatformDef {
        id: "codebuddy",
        name: "CodeBuddy",
        adapter: "codebuddy",
        skills_global: "~/.codebuddy/skills",
        skills_project: ".codebuddy/skills",
        rules_global: Some("~/.codebuddy/rules"),
        rules_project: Some(".codebuddy/rules"),
        rules_single_file_global: false,
        rules_single_file_project: false,
    },
    PlatformDef {
        id: "codebuddy-cn",
        name: "CodeBuddy CN",
        adapter: "codebuddy-cn",
        skills_global: "~/.codebuddy/skills",
        skills_project: ".codebuddy/skills",
        rules_global: Some("~/.codebuddy/rules"),
        rules_project: Some(".codebuddy/rules"),
        rules_single_file_global: false,
        rules_single_file_project: false,
    },
    PlatformDef {
        id: "codex",
        name: "Codex",
        adapter: "codex",
        skills_global: "~/.codex/skills",
        skills_project: ".codex/skills",
        rules_global: Some("~/.codex/rules"),
        rules_project: Some("AGENTS.md"),
        rules_single_file_global: false,
        rules_single_file_project: true,
    },
    PlatformDef {
        id: "hermes",
        name: "Hermes Agent",
        adapter: "hermes",
        skills_global: "~/.hermes/skills",
        skills_project: ".hermes/skills",
        rules_global: Some("~/.hermes/AGENTS.md"),
        rules_project: Some(".hermes.md"),
        rules_single_file_global: true,
        rules_single_file_project: true,
    },
    PlatformDef {
        id: "openclaw",
        name: "OpenClaw",
        adapter: "openclaw",
        skills_global: "~/.openclaw/skills",
        skills_project: ".openclaw/skills",
        rules_global: None,
        rules_project: Some("AGENTS.md"),
        rules_single_file_global: false,
        rules_single_file_project: true,
    },
];

/// Find a platform definition by ID.
pub fn find_platform_def(id: &str) -> Option<&'static PlatformDef> {
    ALL_PLATFORMS.iter().find(|p| p.id == id)
}

/// Extract the file name from a path (e.g., "~/.codex/AGENTS.md" → "AGENTS.md")
fn extract_file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Convert a PlatformDef to the serializable PlatformPaths type.
impl From<&PlatformDef> for PlatformPathsType {
    fn from(def: &PlatformDef) -> Self {
        let global_rules_format = if def.rules_single_file_global {
            def.rules_global.map(|p| RulesFormat::SingleFile {
                file_name: extract_file_name(p),
            })
        } else {
            None
        };
        let project_rules_format = if def.rules_single_file_project {
            def.rules_project.map(|p| RulesFormat::SingleFile {
                file_name: extract_file_name(p),
            })
        } else {
            None
        };

        PlatformPathsType {
            global_skills_dir: def.skills_global.to_string(),
            project_skills_pattern: format!("{{project}}/{}", def.skills_project),
            global_rules_dir: def.rules_global.map(|s| s.to_string()),
            project_rules_pattern: def.rules_project.map(|s| s.to_string()),
            global_rules_format,
            project_rules_format,
        }
    }
}
