//! 适配器（adapters）层：把 ports 中定义的边界接到现有具体实现上。
//!
//! 当前全部为薄直通（pass-through），委托到既有 engine / DB 实现；
//! 目的是解耦 application 层，而非重设计存储模型。

pub mod db;
pub mod filesystem;
