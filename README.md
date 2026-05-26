# SkillForge - AI Agent 技能与规则编排工具

![License](https://img.shields.io/github/license/WebbLee94/SkillForge)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![Version](https://img.shields.io/github/v/release/WebbLee94/SkillForge?include_prereleases)

![Tauri](https://img.shields.io/badge/Tauri-v2-purple)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Rust](https://img.shields.io/badge/Rust-1.70-orange)
![SQLite](https://img.shields.io/badge/SQLite-3-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4)
![Zustand](https://img.shields.io/badge/Zustand-4-22C55E)
![i18next](https://img.shields.io/badge/i18next-23-26A69A)

> 一款桌面应用，用于统一管理 AI Agent（Claude Code / OpenCode / Cursor）的技能和规则，支持场景编排和一键分发

---

## 📖 关于项目

SkillForge 是一款专为 AI Agent 用户打造的技能管理工具，旨在解决多平台技能分散、规则管理繁琐的痛点。通过可视化场景编排，让您轻松组合技能与规则，一键分发到多个 AI Agent 平台。

## ✨ 功能特性

| 模块 | 功能 |
|------|------|
| 📦 **技能库管理** | 安装/卸载/更新技能，支持本地文件和 Git 仓库来源 |
| 📝 **规则管理** | 创建/编辑/删除规则（.mdc/.md/.yaml），版本历史追溯 |
| 🏷️ **标签管理** | 灵活的标签系统，为技能和规则分类 |
| 🎬 **场景编排** | 拖拽组合技能与规则，按场景一键切换 |
| 🚀 **全局/项目分发** | 将场景分发到 Claude Code / OpenCode / Cursor，支持项目级隔离 |
| 🔍 **漂移检测与修复** | Verify & Repair，检测文件系统与 DB 不一致并修复 |

## 🛠️ 技术栈

| 层 | 技术 | 图标 |
|---|---|:---:|
| 桌面框架 | Tauri v2 | 🖥️ |
| 前端 | React 19 + TypeScript | ⚛️ |
| 状态管理 | Zustand | 🧠 |
| 样式 | Tailwind CSS v4 | 🎨 |
| 后端 | Rust | 🦀 |
| 数据库 | SQLite | 📊 |
| 国际化 | i18next | 🌐 |

## 🚀 快速开始

### 环境要求

- **Node.js** >= 20.0.0
- **Rust** (via rustup)
- **Xcode Command Line Tools** (macOS) / **Build Tools for Visual Studio** (Windows)

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/WebbLee94/SkillForge.git
cd SkillForge

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm run tauri dev

# 4. 生产构建
npm run tauri build
```

## 📁 项目结构

```
SkillForge/
├── src/                      # 前端源码
│   ├── pages/                # 页面组件
│   │   ├── Dashboard.tsx     # 看板
│   │   ├── SkillLibrary.tsx  # 技能库
│   │   ├── RulesManager.tsx  # 规则管理
│   │   ├── SceneEditor.tsx   # 场景编排
│   │   └── Distribution.tsx  # 分发管理
│   ├── components/           # 通用组件
│   ├── stores/               # Zustand 状态管理
│   ├── lib/                  # 工具函数与 IPC 封装
│   └── locales/              # i18n 翻译文件
├── src-tauri/                # Rust 后端源码
│   └── src/
│       ├── commands/         # IPC 命令处理
│       ├── engine/           # 业务引擎
│       ├── db/               # 数据库 Schema 与迁移
│       └── plugins/          # 平台适配器
└── docs/                     # 设计文档
```

## 🏗️ 架构概览

```
Frontend (React 19 + Zustand) ──[IPC invoke]──> Rust Backend (rusqlite + engines)
                                                      │
                                                      ▼
                                              ~/.skillforge/  ← SQLite DB + 技能/规则存储
                                                      │
                                                      ▼ (symlink push-only)
                                    ~/.claude/skills/  ~/.config/opencode/skills/  ~/.cursor/skills/
```

## 📋 开发命令

| 命令 | 描述 |
|------|------|
| `npm run dev` | 前端热重载（Vite，端口 1420） |
| `npm run tauri dev` | 完整 Tauri 开发（前端+桌面窗口） |
| `npm run tauri build` | 生产构建（输出 .app/.dmg/.exe） |
| `npm run build` | 仅前端构建 |
| `cargo test` | Rust 后端测试（在 src-tauri/ 目录下） |

## 🤝 参与贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

## 👤 作者信息

- **作者**: Webb Lee
- **GitHub**: [@WebbLee94](https://github.com/WebbLee94)