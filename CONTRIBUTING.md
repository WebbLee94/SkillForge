# 贡献指南

感谢你对 SkillForge 的关注！欢迎提交 Issue 和 Pull Request。

## 开发环境搭建

### 前置条件

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- macOS: [Xcode Command Line Tools](https://developer.apple.com/xcode/)
- Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`
- Windows: [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/JieYueGo/SkillForge.git
cd SkillForge

# 安装前端依赖
npm install

# 启动开发模式
npm run tauri dev

# 运行 Rust 测试
cd src-tauri && cargo test
```

## 代码风格

- **前端**: TypeScript + React 19，2 空格缩进
- **后端**: Rust，4 空格缩进
- **提交信息**: 遵循 [Conventional Commits](https://www.conventionalcommits.org/)，优先使用中文描述
- 项目根目录有 `.editorconfig`，请确保编辑器已安装对应插件

## 提交 PR 流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 提交变更：`git commit -m "feat: 简要描述"`
4. 推送分支：`git push origin feat/your-feature`
5. 在 GitHub 上创建 Pull Request，描述变更内容和目的

### 提交类型

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 Bug |
| `refactor` | 重构（不改变功能） |
| `test` | 测试相关 |
| `docs` | 文档更新 |
| `chore` | 构建/工具链调整 |
| `perf` | 性能优化 |

## 报告问题

- 使用 [Bug Report](https://github.com/JieYueGo/SkillForge/issues/new?template=bug_report.md) 模板
- 描述复现步骤、期望行为和实际行为
- 附上操作系统和 SkillForge 版本信息

## 功能建议

- 使用 [Feature Request](https://github.com/JieYueGo/SkillForge/issues/new?template=feature_request.md) 模板
- 描述使用场景和期望效果
