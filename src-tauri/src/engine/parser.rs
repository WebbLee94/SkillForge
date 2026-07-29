use crate::error::AppError;
use crate::types::{SkillBundle, SkillMeta};

/// Parse a SKILL.md file content into a SkillBundle.
///
/// Expected format:
/// ```markdown
/// ---
/// name: skill-name
/// description: A description of the skill
/// license: MIT
/// compatibility: claude-code, opencode
/// metadata:
///   author: someone
///   tags: [tag1, tag2]
/// allowed-tools:
///   - Read
///   - Write
/// ---
///
/// # Skill Title
///
/// Markdown content here...
/// ```
pub fn parse_skill_md(content: &str) -> Result<SkillBundle, AppError> {
    let content = content.trim_start();

    // Extract YAML frontmatter between --- delimiters
    if !content.starts_with("---") {
        return Err(AppError::Parse(
            "SKILL.md must start with YAML frontmatter (---)".to_string(),
        ));
    }

    let rest = &content[3..];

    // Find the closing ---
    let end_marker = rest.find("\n---").ok_or_else(|| {
        AppError::Parse("SKILL.md frontmatter not closed (missing ---)".to_string())
    })?;

    let yaml_str = &rest[..end_marker];
    let markdown_body = rest[end_marker + 4..].trim_start();

    // Parse YAML frontmatter
    let frontmatter: serde_yaml::Value = serde_yaml::from_str(yaml_str)
        .map_err(|e| AppError::Parse(format!("Invalid YAML: {}", e)))?;

    // Extract required fields
    let name = frontmatter
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Parse("Missing required field: name".to_string()))?
        .to_string();

    let description = frontmatter
        .get("description")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Parse("Missing required field: description".to_string()))?
        .to_string();

    // Validate name: kebab-case, 1-64 chars
    validate_skill_name(&name)?;

    // Validate description length: 1-1024 chars
    if description.is_empty() {
        return Err(AppError::Parse("Description cannot be empty".to_string()));
    }
    if description.len() > 1024 {
        return Err(AppError::Parse(format!(
            "Description too long: {} chars (max 1024)",
            description.len()
        )));
    }

    // Extract optional fields
    let version = frontmatter
        .get("version")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Extract metadata as JSON string
    let metadata = frontmatter
        .get("metadata")
        .and_then(|v| serde_json::to_string(v).ok());

    // Detect subdirectories from markdown body
    let subdirs = detect_subdirs(markdown_body);

    let meta = SkillMeta {
        id: name.clone(),
        name,
        description,
        source_type: String::new(), // Filled by caller
        source_url: None,           // Filled by caller
        version,
        metadata,
    };

    Ok(SkillBundle {
        meta,
        skill_md: markdown_body.to_string(),
        subdirs,
    })
}

/// Validate that a skill name is kebab-case and within length limits
fn validate_skill_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::Parse("Skill name cannot be empty".to_string()));
    }

    if name.len() > 64 {
        return Err(AppError::Parse(format!(
            "Skill name too long: {} chars (max 64)",
            name.len()
        )));
    }

    // Must be kebab-case: lowercase letters, digits, and hyphens
    // Cannot start or end with a hyphen, no consecutive hyphens
    let chars: Vec<char> = name.chars().collect();

    if chars[0] == '-' {
        return Err(AppError::Parse(
            "Skill name cannot start with a hyphen".to_string(),
        ));
    }

    if *chars.last().unwrap() == '-' {
        return Err(AppError::Parse(
            "Skill name cannot end with a hyphen".to_string(),
        ));
    }

    let mut prev_hyphen = false;
    for c in &chars {
        match c {
            'a'..='z' | '0'..='9' => {
                prev_hyphen = false;
            }
            '-' => {
                if prev_hyphen {
                    return Err(AppError::Parse(
                        "Skill name cannot contain consecutive hyphens".to_string(),
                    ));
                }
                prev_hyphen = true;
            }
            _ => {
                return Err(AppError::Parse(format!(
                    "Skill name contains invalid character '{}': only lowercase letters, digits, and hyphens are allowed",
                    c
                )));
            }
        }
    }

    Ok(())
}

/// Detect subdirectory references from markdown body
fn detect_subdirs(markdown: &str) -> Vec<String> {
    let known_subdirs = ["references", "scripts", "rules", "assets", "examples"];
    let mut found = Vec::new();

    let lower = markdown.to_lowercase();

    for subdir in &known_subdirs {
        // Check for references like: [text](references/...) or ./references/ or /references/
        if lower.contains(&format!("{}/", subdir))
            || lower.contains(&format!("./{}/", subdir))
            || lower.contains(&format!("{}:", subdir))
        {
            found.push(subdir.to_string());
        }
    }

    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_skill_md() {
        let content = "---\nname: java-springboot\ndescription: Best practices for Spring Boot\n---\n\n# Java Spring Boot\n\nContent here.";
        let bundle = parse_skill_md(content).unwrap();
        assert_eq!(bundle.meta.id, "java-springboot");
        assert_eq!(bundle.meta.name, "java-springboot");
        assert_eq!(bundle.meta.description, "Best practices for Spring Boot");
        assert_eq!(bundle.skill_md, "# Java Spring Boot\n\nContent here.");
    }

    #[test]
    fn test_parse_with_optional_fields() {
        let content = "---\nname: my-skill\ndescription: A skill\nversion: \"1.0\"\nmetadata:\n  author: test\n---\n\nContent";
        let bundle = parse_skill_md(content).unwrap();
        assert_eq!(bundle.meta.version, Some("1.0".to_string()));
        assert!(bundle.meta.metadata.is_some());
    }

    #[test]
    fn test_parse_missing_name() {
        let content = "---\ndescription: No name\n---\n\nContent";
        let result = parse_skill_md(content);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("name"));
    }

    #[test]
    fn test_parse_missing_description() {
        let content = "---\nname: test-skill\n---\n\nContent";
        let result = parse_skill_md(content);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("description"));
    }

    #[test]
    fn test_parse_no_frontmatter() {
        let content = "# Just markdown\nNo frontmatter";
        let result = parse_skill_md(content);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_unclosed_frontmatter() {
        let content = "---\nname: test\ndescription: test";
        let result = parse_skill_md(content);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_skill_name_valid() {
        assert!(validate_skill_name("java-springboot").is_ok());
        assert!(validate_skill_name("python3-testing").is_ok());
        assert!(validate_skill_name("a").is_ok());
    }

    #[test]
    fn test_validate_skill_name_invalid() {
        assert!(validate_skill_name("").is_err());
        assert!(validate_skill_name("-start").is_err());
        assert!(validate_skill_name("end-").is_err());
        assert!(validate_skill_name("double--hyphen").is_err());
        assert!(validate_skill_name("UpperCase").is_err());
        assert!(validate_skill_name("has space").is_err());
        assert!(validate_skill_name("has_underscore").is_err());
    }

    #[test]
    fn test_validate_skill_name_too_long() {
        let long_name = "a".repeat(65);
        assert!(validate_skill_name(&long_name).is_err());
    }

    #[test]
    fn test_detect_subdirs() {
        let md = "See [docs](references/api.md) and run scripts/deploy.sh";
        let subdirs = detect_subdirs(md);
        assert!(subdirs.contains(&"references".to_string()));
        assert!(subdirs.contains(&"scripts".to_string()));
    }

    #[test]
    fn test_parse_with_subdir_detection() {
        let content = "---\nname: test-skill\ndescription: A test\n---\n\nSee [API](references/api.md) for details.";
        let bundle = parse_skill_md(content).unwrap();
        assert!(bundle.subdirs.contains(&"references".to_string()));
    }
}
