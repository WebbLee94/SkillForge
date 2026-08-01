# Changelog

## v1.1.0 (2026-08-01)

### 🆕 新增

- **双向同步（感知型同步）**：文件监控引擎实时感知所有已启用 Agent 平台的外部技能/规则变更
- **自写回声抑制**：dist_engine 写操作自动静音 watcher，避免假阳性事件
- **三态同步状态**：看板支持已同步🟢 / 已缺失🔴 / 有更新🟡 三种状态
- **变更通知栏**：检测到外部变更时自动弹出通知，支持一键导入/忽略
- **自动更新检测**：Git 来源的技能定时检查新版本（默认 6h）

### 📦 MCP（已归档）

MCP（Model Context Protocol）服务器管理功能已完成完整实现，但因各平台配置格式差异大、维护成本高，经评估决定从 v1.1.0 版本中移除，相关代码归档至分支 `back/mcp_v1.1.0`。未来是否上线待定。

**已归档的成果：**
- Rust 后端：mcp_servers DB 表 + CRUD 引擎 + 6 平台格式转换 + 6 平台导出适配器 + 健康检查 + MCP 平台计数
- 前端：McpManager 页面 + McpCard/McpForm/McpDistributeDialog 组件 + 场景编排 MCP tab + 看板 MCP 统计卡片
- 导出适配器：Claude Desktop / Cursor / VS Code / Cline / Roo Code / Windsurf 6 平台原生格式

详见 [ADR-007](../SkillForge-docs/05-决策记录/007-MCP功能归档决策.md)。

### 🔧 改进

- 技能列表不再将已缺失的技能显示为"已同步"
- 新增 `watcher_events` 审计表，完整记录所有文件变更事件

### 📦 依赖

- 新增 `notify` 6.x（跨平台文件系统监控）
- 新增 `hex` 0.4（哈希编码）
- 新增 `walkdir` 2.x（目录遍历）
- 新增 `log` 0.4（日志门面）

## v1.0.1 (2026-06-10)

### 🆕 新增

- **一键导入**：Dashboard 新增"一键导入"功能，自动扫描所有 Agent 平台的全局目录，发现尚未导入的技能和规则，预览确认后批量导入。首次使用时自动弹出引导卡片

> **推荐更新**：本版本修复了 3 项可能导致数据丢失或状态错误的严重问题，建议所有 v1.0.0 用户升级。

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

## v1.0.0 (2026-05-27)

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
- 版本号统一为 v1.0.0（package.json / Cargo.toml / tauri.conf.json）

### 移除

- 漂移检测功能（verify/repair/drift_status/startup_integrity_check）
- @dnd-kit/* 依赖（改用原生 HTML5 拖拽）
- TagsManager 独立页面和 InlineTagEditor 旧组件
- 所有 eprintln! 和 console.error/log 诊断日志
- 未用代码（sourceFilter、truncate、debounce）
- 未用 i18n key（settings.json 12 个）
