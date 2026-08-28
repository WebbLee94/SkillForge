[简体中文](./README.md) | [English](./README.en.md)

# SkillForge - AI Agent Skills & Rules Orchestration Tool

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

> A desktop app for managing AI Agent skills and rules in one place, supporting 10 platforms, scene-based orchestration, and one-click Distribution.

---

## 📖 About

SkillForge is a skill management tool built for AI Agent users. It solves the pain of skills scattered across platforms and rules that are tedious to manage. With visual Scene orchestration, you can combine Skills and Rules with ease and distribute them to multiple AI Agent platforms in one click.

## ✨ Features

| Module | Capability |
|--------|------------|
| 📦 **Skill Library** | Install/uninstall/update Skills from local folders or Git repositories |
| 📝 **Rule Management** | Create/edit/delete Rules (.mdc/.md/.yaml), version history, side-by-side preview |
| 🏷️ **Tag Management** | Inline tag creation and filtering, dialog-based tag management |
| 🎬 **Scene Orchestration** | Combine Skills and Rules into Scenes, switch per Scene in one click, platform-level diff |
| 🚀 **Global/Project Distribution** | Distribute Scenes to 10 AI Agent platforms with project-level isolation |
| 🧠 **Platform Capability Awareness** | Auto-detect each platform's Distribution capabilities and warn when unsupported |
| 🌍 **Multilingual UI** | Follows system or browser language by default, so Chinese macOS users see Chinese UI automatically |
| ⬆️ **App Updates** | The Settings page can check for new versions, download them, and relaunch automatically |
| 🌐 **Multi-Platform Support** | Claude Code / OpenCode / Cursor / Trae / CodeBuddy / Codex / Hermes / OpenClaw and more — 10 platforms in total |

## 📸 Screenshots

![SkillForge Dashboard](public/images/dashboard_en.png)

*SkillForge desktop app main window — manage AI Agent Skills and Rules in one place*

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop framework | Tauri v2 |
| Frontend | React 19 + TypeScript |
| State management | Zustand |
| Styling | Tailwind CSS v4 |
| Backend | Rust |
| Database | SQLite |
| Internationalization | i18next |

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **Rust** (via rustup)
- **Xcode Command Line Tools** (macOS) / **Build Tools for Visual Studio** (Windows)

### Common Commands

```bash
# 1. Clone the repository
git clone https://github.com/WebbLee94/SkillForge.git
cd SkillForge

# 2. Install dependencies
npm install

npm run dev

# 3. Start the full Tauri dev environment
npm run tauri dev

# 4. Production build
npm run tauri build

# 5. Frontend-only build
npm run build

# 6. Frontend tests
npm test

# 7. Rust backend tests (inside src-tauri/)
cargo test

# 8. Desktop E2E tests
npm run test:e2e
```

## 🔗 Project Links

- [GitHub repository](https://github.com/WebbLee94/SkillForge)
- [Issue tracker](https://github.com/WebbLee94/SkillForge/issues)
- [Feature discussions](https://github.com/WebbLee94/SkillForge/discussions)
- [Get help](SUPPORT.md)

## 📁 Project Structure

```
SkillForge/
├── src/                      # Frontend source
│   ├── app/                  # App shell (sidebar, topbar, etc.)
│   ├── pages/                # Page components
│   │   ├── Dashboard.tsx     # Dashboard
│   │   ├── SkillLibrary.tsx  # Skill Library
│   │   ├── RulesManager.tsx  # Rule Management
│   │   ├── SceneEditor.tsx   # Scene Orchestration
│   │   ├── GlobalDistribution.tsx  # Global Distribution
│   │   ├── ProjectDistribution.tsx # Project Distribution
│   │   └── Settings.tsx      # Settings
│   ├── domains/              # Domain modules (skills, rules, scenes, distribution, etc.)
│   ├── components/           # Shared components
│   ├── hooks/                # Custom hooks
│   ├── stores/               # Zustand state management
│   ├── lib/                  # Utilities and IPC wrappers
│   └── locales/              # i18n translation files
├── src-tauri/                # Rust backend source
│   └── src/
│       ├── commands/         # IPC command handlers
│       ├── engine/           # Business engines
│       ├── db/               # Database schema and migrations
│       ├── plugins/          # Platform adapters (10)
│       └── domain/ application/ ports/ adapters/  # Domain model and port/adapter layers
```

## 🏗️ Architecture Overview

```
Frontend (React 19 + Zustand) ──[IPC invoke]──> Rust Backend (rusqlite + engines)
                                                      │
                                                      ▼
                                              ~/.skillforge/  ← SQLite DB + skill/rule storage
                                                      │
                                                      ▼ (symlink, one-way push distribution)
                              claude-code/ opencode/ cursor/ trae/ codebuddy/ codex/ hermes/ openclaw/ ... (10 platforms)
```

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

Before submitting, please read the [contributing guide](CONTRIBUTING.md), the [Code of Conduct](CODE_OF_CONDUCT.md), and the [governance notes](GOVERNANCE.md). For security vulnerabilities, please follow the [security policy](SECURITY.md) — do not open a public issue.

## 🙏 Acknowledgments

This project's design draws inspiration from [skills-manager](https://github.com/xingkongliang/skills-manager). Thanks to [@xingkongliang](https://github.com/xingkongliang) for the open-source contribution.

## 📄 License

This project is licensed under the [MIT License](LICENSE).

## 🔗 Community & Support

- [Issue tracker](https://github.com/WebbLee94/SkillForge/issues)
- [Feature discussions](https://github.com/WebbLee94/SkillForge/discussions)
- [Get help](SUPPORT.md)

## 👤 Author

- **Author**: Webb Lee
- **GitHub**: [@WebbLee94](https://github.com/WebbLee94)
