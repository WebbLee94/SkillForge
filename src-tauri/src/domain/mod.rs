//! 领域层：纯业务模型与规则。
//!
//! 约束：本层代码不依赖数据库、文件系统、平台插件或 Tauri；
//! 仅允许 serde / regex 等纯计算依赖与全局错误类型 `AppError`
//! （用于保持既有 IPC 错误字符串不变）。

pub mod distribution;
