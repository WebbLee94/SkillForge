# SkillForge - AI Agent 技能与规则编排工具

> 一款桌面应用，用于统一管理 AI Agent（Claude Code / OpenCode / Cursor）的技能和规则，支持场景编排和一键分发

## 功能特性

- **技能库管理** — 安装/卸载/更新技能，支持本地文件和 Git 仓库来源
- **规则管理** — 创建/编辑/删除规则（.mdc/.md/.yaml），版本历史追溯
- **标签管理** — 灵活的标签系统，为技能和规则分类
- **场景编排** — 拖拽组合技能与规则，按场景一键切换
- **全局/项目分发** — 将场景分发到 Claude Code / OpenCode / Cursor，支持项目级隔离
- **漂移检测与修复** — Verify & Repair，检测文件系统与 DB 不一致并修复

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Tauri v2 |
| 前端 | React 19 + TypeScript + Zustand |
| 样式 | Tailwind CSS v4 |
| 后端 | Rust + rusqlite |
| 数据库 | SQLite（~/.skillforge/skillforge.db） |
| 国际化 | i18next（中文/英文） |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发模式（前端热重载 + Tauri 桌面窗口）
npm run tauri dev

# 生产构建
npm run tauri build
```

> 前置条件：[Node.js 20+](https://nodejs.org/)、[Rust](https://rustup.rs/)、[Xcode Command Line Tools](https://developer.apple.com/xcode/)

## 截图

<!-- 截图占位，后续替换为实际截图 -->

| 看板 | 场景编排 | 全局分发 |
|:---:|:---:|:---:|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Scene Editor](docs/screenshots/scene-editor.png) | ![Distribution](docs/screenshots/distribution.png) |

## 目录结构

```
SkillForge/
├── src/                        # 前端源码
│   ├── pages/                  # 页面组件
│   │   ├── Dashboard.tsx       # 看板
│   │   ├── SkillLibrary.tsx    # 技能库
│   │   ├── RulesManager.tsx    # 规则管理
│   │   ├── SceneEditor.tsx     # 场景编排
│   │   ├── GlobalDistribution.tsx  # 全局分发
│   │   └── ProjectDistribution.tsx # 项目分发
│   ├── components/             # 通用组件
│   ├── stores/                 # Zustand 状态管理
│   ├── lib/                    # 工具函数与 IPC 封装
│   ├── locales/                # i18n 翻译文件
│   └── types/                  # TypeScript 类型定义
├── src-tauri/                  # Rust 后端源码
│   └── src/
│       ├── commands/           # IPC 命令处理
│       ├── engine/             # 业务引擎（技能/场景/分发/解析）
│       ├── db/                 # 数据库 Schema 与迁移
│       ├── plugins/            # 平台适配器与来源适配器
│       └── lib.rs              # Tauri 入口
└── docs/                       # 设计文档
```

## 架构概览

```
Frontend (React 19 + Zustand) ──[IPC invoke]──> Rust Backend (rusqlite + engines)
                                                      │
                                                      ▼
                                              ~/.skillforge/  ← SQLite DB + 技能/规则存储
                                                      │
                                                      ▼ (symlink push-only)
                                    ~/.claude/skills/  ~/.config/opencode/skills/  ~/.cursor/skills/
```

## 开发命令

```bash
npm run dev             # 前端热重载（Vite，端口 1420）
npm run tauri dev       # 完整 Tauri 开发（前端+桌面窗口）
npm run tauri build     # 生产构建（输出 .app/.dmg）
npm run build           # 仅前端构建 (tsc + vite build)
cargo test              # Rust 后端测试（在 src-tauri/ 目录下）
```

## License

[MIT](LICENSE)
