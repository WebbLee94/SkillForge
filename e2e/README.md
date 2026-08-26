# SkillForge E2E 测试（桌面 WebDriver）

基于 **WebdriverIO + `@wdio/tauri-service`（embedded driver）** 的真实桌面 E2E 测试：
驱动真实 Tauri 桌面窗口 + 真实 Rust 后端 IPC，macOS 原生支持，不依赖 computer-use / ChatGPT 认证。

## 前置条件

- Node.js 18+（本项目使用 24）
- Rust 工具链（`cargo`）
- Tauri CLI（主项目已含 `@tauri-apps/cli`）

## 一次性准备

1. 安装测试依赖：

```bash
cd SkillForge
npm install --save-dev @wdio/tauri-plugin@1.3.0
cd e2e && npm install
```

2. 构建含 wdio 插件的 debug 二进制（插件仅 debug 构建注册，release 不含）：

```bash
cd src-tauri && cargo build
```

## 运行测试

```bash
# 在 SkillForge 根目录
npm run test:e2e
```

或直接：

```bash
cd e2e && npx wdio run wdio.conf.js
```

## 测试内容

| 文件 | 覆盖 |
|------|------|
| `specs/smoke.spec.js` | 窗口加载、中文导航渲染、Rust IPC（list_platforms / get_app_config） |
| `specs/interaction.spec.js` | 导航点击跳转、看板统计、场景列表、同步状态、DB 大小 |
| `specs/distribution-workflow.spec.js` | 首次分发完整流程：预览 → 取消 → 确认 → 执行 → 幂等 → 重启状态保持（只读安全策略，避免污染真实环境） |

## 技术说明

- **driver provider**: `embedded`（`tauri-plugin-wdio-webdriver` 在 app 内嵌 WebDriver HTTP server，端口 4445），macOS 无需外部 driver
- **execute API**: `tauri-plugin-wdio` 提供 `browser.tauri.execute()` 直接调用 Rust 命令
- **前端插件注入**: `main.tsx` 在 `VITE_E2E=true` 时动态 `import('@wdio/tauri-plugin')`，生产构建自动 tree-shake（已验证 0 引用）
- **配置**: `e2e/wdio.conf.js` 的 `onPrepare` 自动启动 Vite dev server（端口 1420），`onComplete` 清理
- **版本对齐**: Rust 插件 `tauri-plugin-wdio` + `tauri-plugin-wdio-webdriver`（1.3）与 npm `@wdio/tauri-service` + `@wdio/tauri-plugin`（1.3）需一致

## 已知 QA 发现

- `list_scenes` 不返回 `__all_skills__` 虚拟场景（该场景为运行时概念，未持久化到 DB）—— 已按实际行为断言
