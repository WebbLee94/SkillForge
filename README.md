# SkillForge - AI Agent 技能与规则编排工具

![License](https://img.shields.io/github/license/WebbLee94/SkillForge)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![Version](https://img.shields.io/github/v/release/WebbLee94/SkillForge?include_prereleases)

![Tauri](https://img.shields.io/badge/Tauri-v2-purple)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Rust](https://img.shields.io/badge/Rust-stable-orange)
![SQLite](https://img.shields.io/badge/SQLite-3-blue)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4)
![Zustand](https://img.shields.io/badge/Zustand-5-22C55E)
![i18next](https://img.shields.io/badge/i18next-26-26A69A)

> 一款桌面应用，用于统一管理 AI Agent 的技能和规则，支持 10 个平台、场景编排和一键分发

---

## 📖 关于项目

SkillForge 是一款专为 AI Agent 用户打造的技能管理工具，旨在解决多平台技能分散、规则管理繁琐的痛点。通过可视化场景编排，让您轻松组合技能与规则，一键分发到多个 AI Agent 平台。

## ✨ 功能特性

| 模块 | 功能 |
|------|------|
| 📦 **技能库管理** | 安装/卸载/更新技能，支持本地文件和 Git 仓库来源 |
| 📝 **规则管理** | 创建/编辑/删除规则（.mdc/.md/.yaml），版本历史追溯，双栏预览 |
| 🏷️ **标签管理** | 内联标签创建与筛选，弹窗式标签管理 |
| 🎬 **场景编排** | 组合技能与规则，按场景一键切换，平台维度 diff |
| 🚀 **全局/项目分发** | 将场景分发到 10 个 AI Agent 平台，支持项目级隔离 |
| 🧠 **平台能力感知** | 自动检测平台分发能力，不支持时显示警告 |
| 🌐 **多平台支持** | Claude Code / OpenCode / Cursor / Trae / CodeBuddy / Codex / Hermes / OpenClaw 等 10 个平台 |

## 🧱 v1.1.0 公开基线说明

> **v1.1.0 是 SkillForge 的首个公开基线版本。** 当前公开能力范围为：技能库（Skills）、规则（Rules）、场景编排（Scenes）、项目分发（Projects）、平台管理（Platforms）与全局/项目分发（Distribution）。数据库以当前 schema 作为公开 v1 基线（schema version 1），不再携带历史升级链。MCP 管理、Hook、LLM 集成、技能市场、多用户协作等能力不在 v1.1.0 范围内。

> ⚠️ **旧开发数据库不保证兼容**：如遇数据异常，可删除本地数据库后重启，应用将按公开基线从零重建：
>
> ```bash
> rm -f ~/.skillforge/skillforge.db ~/.skillforge/skillforge.db-wal ~/.skillforge/skillforge.db-shm
> ```

## 📸 界面预览

![SkillForge 看板](public/images/dashboard.png)

*SkillForge 桌面应用主界面 —— 统一管理 AI Agent 技能与规则*

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
│   │   ├── GlobalDistribution.tsx  # 全局分发
│   │   └── ProjectDistribution.tsx # 项目分发
│   ├── components/           # 通用组件
│   ├── stores/               # Zustand 状态管理
│   ├── lib/                  # 工具函数与 IPC 封装
│   └── locales/              # i18n 翻译文件
├── src-tauri/                # Rust 后端源码
│   └── src/
│       ├── commands/         # IPC 命令处理
│       ├── engine/           # 业务引擎
│       ├── db/               # 数据库 Schema 与迁移
│       └── plugins/          # 平台适配器（10 个）
```

## 🏗️ 架构概览

```
Frontend (React 19 + Zustand) ──[IPC invoke]──> Rust Backend (rusqlite + engines)
                                                      │
                                                      ▼
                                              ~/.skillforge/  ← SQLite DB + 技能/规则存储
                                                      │
                                                      ▼ (symlink, one-way push distribution)
                              claude-code/ opencode/ cursor/ trae/ codebuddy/ codex/ hermes/ openclaw/ ... (10 平台)
```

## 📋 开发命令

| 命令 | 描述 |
|------|------|
| `npm run dev` | 前端热重载（Vite，端口 1420） |
| `npm run tauri dev` | 完整 Tauri 开发（前端+桌面窗口） |
| `npm run tauri build` | 生产构建（输出 .app/.dmg/.exe） |
| `npm run build` | 仅前端构建（tsc + Vite） |
| `npm test` | 前端单元/组件测试（Vitest） |
| `npm run test:e2e` | 桌面 E2E 测试（WebdriverIO + tauri-driver） |
| `cargo test` | Rust 后端测试（在 src-tauri/ 目录下） |

## 🤝 参与贡献

欢迎贡献代码！请遵循以下步骤：

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

提交前请阅读 [贡献指南](CONTRIBUTING.md)、[社区行为准则](CODE_OF_CONDUCT.md) 和 [治理说明](GOVERNANCE.md)。安全漏洞请遵循 [安全策略](SECURITY.md)，不要公开创建 Issue。

## 🙏 致谢

本项目设计参考了 [skills-manager](https://github.com/xingkongliang/skills-manager)，感谢 [@xingkongliang](https://github.com/xingkongliang) 的开源贡献。

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

## 🔗 社区与支持

- [问题反馈](https://github.com/WebbLee94/SkillForge/issues)
- [功能讨论](https://github.com/WebbLee94/SkillForge/discussions)
- [获取帮助](SUPPORT.md)

## 👤 作者信息

- **作者**: Webb Lee
- **GitHub**: [@WebbLee94](https://github.com/WebbLee94)
