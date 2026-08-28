# Changelog

## v1.0.0 (2026-08-28) 🎉 首个公开发布版本

> SkillForge 的首个公开发布版本，用于统一管理 AI Agent 的技能与规则，支持 10 个平台、场景编排与一键分发。

### 核心功能

- **技能库管理**：安装/卸载/更新技能，支持本地文件与 Git 仓库来源
- **规则管理**：创建/编辑/删除规则（.mdc/.md/.yaml），支持版本历史追溯与双栏预览
- **标签管理**：支持内联标签创建、筛选与弹窗管理
- **场景编排**：组合技能与规则，按场景一键切换，并支持平台维度 diff
- **全局/项目分发**：将场景分发到 10 个 AI Agent 平台，支持项目级隔离
- **平台能力感知**：自动检测平台分发能力，不支持时给出提示
- **外部变更感知**：文件监控引擎感知已启用平台上的外部技能/规则变更
- **自动更新检测**：Git 来源技能定时检查新版本

### 平台支持

Claude Code / OpenCode / Cursor / Trae / CodeBuddy / Codex / Hermes / OpenClaw / Antigravity / Windsurf（共 10 个）

### 架构与质量

- **统一资源模型**：数据库存储层从 skills/rules 六表合并为 resources/resource_tags/scene_items 三表
- **场景保存原子化**：场景及其成员关系以数据库事务整体提交
- **分发预览识别内容变更**：已分发资源正文变化时可正确归入待更新列表
- **文件监控链路清理**：外部变更事件统一走内存通知链路
- **Vitest / Rust / E2E**：前端 860 用例、Rust 333 用例、桌面 E2E 4 个 spec，均已通过

### 工程基础

- **i18n 覆盖**：中文 / 英文双语支持，6 个 namespace
- **CSP 安全策略**：限制默认资源来源
- **CI 门禁**：三平台构建、测试、lint 与发布校验已启用
- **Windows 安装器**：NSIS 与安装钩子已配置

### 备注

- 本版本是对外首发版本，历史内测版本内容已不作为用户主叙事

## v0.0.2 (2026-06-10) 内部测试版

### 🆕 新增

- **一键导入**：Dashboard 新增"一键导入"功能，自动扫描所有 Agent 平台的全局目录，发现尚未导入的技能和规则，预览确认后批量导入。首次使用时自动弹出引导卡片

> **推荐更新**：本版本修复了 3 项可能导致数据丢失或状态错误的严重问题，建议所有 v0.0.1 用户升级。

### 🔴 重要修复

- **覆盖安装技能后标签和场景关系丢失**：旧版覆盖安装错误地执行"先删后装"，触发了数据库级联删除。现已改为增量更新模式，标签和场景绑定完整保留
- **同步后状态始终显示"待同步"**：全局分发和项目分发的同步状态不更新（灰色图标、蓝色进度条）。根因是旧版将日期字符串写入了状态字段，且多次同步的重复记录导致状态查询歧义。现已修复写入和查询逻辑，同步后正确显示"已同步"（绿色图标、绿色进度条）
- **Directory 模式规则分发残留文件**：场景中移除的规则不会自动从平台目录删除。现已统一为完整 diff 策略，与技能分发行为一致

### 🟡 体验改进

- 批量安装技能时界面支持滚动，结果合并为一条提示，子目录完整复制
- 看板和全局分发页面的场景选择保持一致
- 项目添加时路径选择前置，选中文件夹后自动填充项目名称
- 设置页新增分发方式说明，解释技能（符号链接）和规则（文件复制）差异

### 🟢 小幅调整

- 新建规则默认格式改为 `.md`（日常最常用格式）
- 删除规则后标签计数同步更新
- 看板 xx/xx 格式改为"已安装技能数 / 已同步规则数"
- 技能安装界面暂时隐藏 Git 选项
- GitHub 仓库链接修正为 `WebbLee94/SkillForge`
- README.md 添加开源致谢

## v0.0.1 (2026-05-27) 内部测试版

> 勘误（2026-08-23）：本条目中'12 个平台'宣称有误，v0.0.x 实际内置平台为 10 个，详见 v1.0.0 条目。

### 新增

#### 核心功能
- 技能库管理：安装/卸载/更新技能（本地文件 + Git 仓库）
- 规则管理：创建/编辑/删除规则（.mdc/.md/.yaml），版本历史，双栏预览
- 标签管理：内联标签创建（TagPopover）、弹窗式标签管理（TagManagerDialog）、横向 Chip 筛选栏（TagFilterBar）
- 场景编排：创建场景，添加技能和规则，配置目标平台，标签筛选
- 全局分发：将场景分发到 12 个 AI Agent 平台，支持自定义覆盖平台
- 项目分发：绑定场景到项目目录，按需分发
- Diff-Based 场景切换：增量同步，平台维度 diff，无中间空白期
- 平台能力感知：自动检测平台分发能力（L1 标签/L2 Toast/L3 矩阵）
- SingleFile 规则合并：SKILLFORGE 标记引擎，保留用户内容
- 12 个 AI Agent 平台支持：Claude Code / OpenCode / Cursor / Trae / Trae CN / CodeBuddy / CodeBuddy CN / Codex / Hermes / OpenClaw / Antigravity / Windsurf

#### 界面与体验
- 看板：全局分发状态、统计卡片
- 设置页面：语言切换（含"跟随系统"）、数据目录、DB 大小、版本信息、GitHub 链接
- 设置页面-平台管理 Tab：12 平台列表、能力矩阵（✅/❌）、启用/禁用切换、SVG 图标
- 规则编辑器双栏预览：编辑/预览/双栏三种视图模式切换
- Markdown 规则实时预览（react-markdown + remark-gfm）
- YAML 规则键值对树形展示
- 技能/规则批量删除
- 规则导入功能
- i18n：中文/英文双语支持（6 个 namespace）

#### 基础设施
- 多平台 CI：macOS + Windows + Linux PR 检查，3 平台 Release 手动触发构建
- CSP 安全策略：限制 default-src/img-src/style-src 来源
- tauri.conf.json 平台配置：macOS 最低版本 12.0、Windows 中文安装、Linux deb 依赖
- .editorconfig 统一缩进风格
- CONTRIBUTING.md 贡献指南
- GitHub 开源发布文件：README / LICENSE / CHANGELOG / Issue Templates / CI Workflow

### 改进

- 标签管理从独立页面重构为内联弹窗模式，减少导航层级
- 场景编辑器支持标签筛选技能/规则
- 全局分发支持场景-平台关联和自定义覆盖
- 看板全局分发状态：平台同步状态改为 compact badge 样式
- 所有硬编码中文替换为 i18n t() 调用
- 版本号统一为 v0.0.1（package.json / Cargo.toml / tauri.conf.json）

### 移除

- 漂移检测功能（verify/repair/drift_status/startup_integrity_check）
- @dnd-kit/* 依赖（改用原生 HTML5 拖拽）
- TagsManager 独立页面和 InlineTagEditor 旧组件
- 所有 eprintln! 和 console.error/log 诊断日志
- 未用代码（sourceFilter、truncate、debounce）
- 未用 i18n key（settings.json 12 个）
