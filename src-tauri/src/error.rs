use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Database(String),
    #[error("技能未找到: {0}")]
    SkillNotFound(String),
    #[error("技能已安装: {0}")]
    DuplicateSkill(String),
    #[error("技能正在被 {0} 个场景使用: {1}")]
    SkillInUse(i32, String),
    #[error("场景未找到: {0}")]
    SceneNotFound(String),
    #[error("场景被 {0} 个项目使用")]
    SceneInUse(i32),
    #[error("项目未找到: {0}")]
    ProjectNotFound(String),
    #[error("项目已存在: {0}")]
    DuplicateProject(String),
    #[error("规则未找到: {0}")]
    RuleNotFound(String),
    #[error("标签未找到: {0}")]
    TagNotFound(i64),
    #[error("标签已存在: {0}")]
    DuplicateTag(String),
    #[error("来源错误: {0}")]
    Source(String),
    #[error("平台错误: {0}")]
    Platform(String),
    #[error("解析错误: {0}")]
    Parse(String),
    #[error("IO错误: {0}")]
    Io(String),
    #[error("验证错误: {0}")]
    Validation(String),
    #[error("分发请求无效: {0}")]
    DistributionInvalid(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
