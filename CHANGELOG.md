# Changelog

## v1.0.0 (待发布) 🎉 首个公开发布版本

### 🔒 首个公开基线声明

**v1.0.0 是 SkillForge 的首个公开基线版本**。当前公开能力范围为 Skills（技能库）/ Rules（规则）/ Scenes（场景编排）/ Projects（项目分发）/ Platforms（平台管理）/ Distribution（全局与项目分发）六大模块。

- **数据库基线重置**：数据库迁移重置为 schema version 1——全新启动直接创建当前完整 schema 并标记版本 1，运行时不再保留 v2–v6 历史升级链；未来 schema 变更自该公开基线起演进
- **旧开发数据库不保证兼容**：在旧开发版本上产生的本地数据库不再被升级修复。如遇异常请删除后重启应用，从零重建公开 v1 基线：

  ```bash
  rm -f ~/.skillforge/skillforge.db ~/.skillforge/skillforge.db-wal ~/.skillforge/skillforge.db-shm
  ```

- **范围外能力**：MCP 管理（已归档）、Hook、LLM 集成、技能市场、多用户协作等均不在 v1.0.0 公开范围内

### 🆕 新增

- **外部变更感知（文件监控）**：文件监控引擎实时感知所有已启用 Agent 平台的外部技能/规则变更（辅助能力，非核心承诺范围——核心仍为 Skills/Rules 分发）
- **自写回声抑制**：dist_engine 写操作自动静音 watcher，避免假阳性事件
- **三态同步状态**：看板支持已同步🟢 / 已缺失🔴 / 有更新🟡 三种状态
- **变更通知栏**：检测到外部变更时自动弹出通知，支持一键导入/忽略
- **自动更新检测**：Git 来源的技能定时检查新版本（默认 6h）

### 📦 MCP（已归档）

MCP（Model Context Protocol）服务器管理功能已完成完整实现，但因各平台配置格式差异大、维护成本高，经评估决定从 v1.0.0 版本中移除，相关代码归档至独立归档分支。未来是否上线待定。

**已归档的成果：**
- Rust 后端：mcp_servers DB 表 + CRUD 引擎 + 6 平台格式转换 + 6 平台导出适配器 + 健康检查 + MCP 平台计数
- 前端：McpManager 页面 + McpCard/McpForm/McpDistributeDialog 组件 + 场景编排 MCP tab + 看板 MCP 统计卡片
- 导出适配器：Claude Desktop / Cursor / VS Code / Cline / Roo Code / Windsurf 6 平台原生格式

详见独立文档仓库 SkillForge-docs 中 ADR-007《MCP 功能归档决策》。

### 📦 依赖

- 新增 `notify` 6.x（跨平台文件系统监控）
- 新增 `hex` 0.4（哈希编码）
- 新增 `walkdir` 2.x（目录遍历）
- 新增 `log` 0.4（日志门面）

### 🧪 质量与测试

- **Vitest 覆盖率门禁 ≥60%**：配置 Vitest 覆盖率阈值，确保前端核心模块最小覆盖，防止未测试代码合入
- **ESLint flat config + typescript-eslint**：从旧式 `.eslintrc` 迁移至 ESLint flat config，统一前端代码规范
- **前端 Zustand Store 测试**：覆盖分发状态管理的完整链路，验证同步状态机运转正确
- **Rust 集成测试**：覆盖完整分发链路（watcher → dist_engine → platform 写入），验证端到端正确性

### 🔧 改进

- 技能列表不再将已缺失的技能显示为"未分发"
- **P0/P1 发布前修复**：修复 5 个 TypeScript 类型错误、2 个 clippy 告警
- **i18n 硬编码迁移**：51 处硬编码中文替换为 i18n `t()` 调用，补齐国际化覆盖
- **Emoji 替换为 lucide 图标**：移除 UI 中所有 Emoji 字符，统一使用 `@radix-ui/react-icons`（lucide）
- **Dashboard 统计卡片配色修复**：统计数据卡片颜色值对齐设计规范
- **清理失效 i18n 键**：移除 19 个未引用的死键，减少产物体积
- **统一资源模型**（架构重构）：数据库存储层从 skills/rules 六表合并为 resources/resource_tags/scene_items 三表——标签与场景成员关系随之简化，为未来扩展新资源类型预留容器；对用户的可见变化为技能库/规则管理页数据源不变、标签系统按资源类型隔离（技能标签与规则标签各自独立）、场景编排支持技能与规则的混合成员
- **分发预览可识别"内容有更新"的资源**（硬化批）：预览结果新增内容级 Update 分类——已分发资源的正文发生变化时（即使名称与位置不变），预览会正确归入待更新列表，不再被遗漏
- **场景保存原子化**（硬化批）：场景及其成员关系以数据库事务整体提交，任一步骤失败即整体回滚，不再产生半保存的中间状态
- **文件监控链路清理**（硬化批）：移除文件监控中已废弃的数据库写入路径，外部变更事件统一走内存通知链路

### 🛠 工具链

- **coverage/ 目录加入 .gitignore**：避免覆盖率报告文件和产物被版本控制追踪
- **CI build.yml 增加 ESLint 检查 + 覆盖率报告**：PR 自动执行前端 lint 和覆盖率检查
- **CI release.yml 增加测试门禁**：版本发布前自动运行测试套件，测试失败阻断发布流程

### 🧪 E2E 测试框架（2026-08-11）

- **桌面 E2E 测试框架落地**：WebdriverIO + @wdio/tauri-service，macOS embedded driver（内嵌 WebDriver，端口 4445），驱动真实 Tauri 窗口 + Rust IPC，不依赖 computer-use/accessibility bridge
- **E2E 陈旧进程守卫**（硬化批）：运行 E2E 前自动清理残留的 Vite dev server / WebDriver 进程，避免端口占用导致的启动失败
- **桌面 E2E 共 4 个 spec**：smoke（冒烟）/ interaction（交互）/ distribution-workflow（首次分发完整流程：预览→取消→确认→执行→幂等→重启状态保持）/ stats-grid-responsive（看板统计网格响应式）
- **CI 三平台 e2e 矩阵**（`.github/workflows/e2e.yml`）：macOS（embedded）+ Windows/Linux（external + tauri-driver + xvfb），验证跨平台冒烟
- **README 入口修正**：平台数 12→10、双向同步→单向分发、docs 路径指向 SkillForge-docs 独立仓库、补充测试命令

### 📊 测试口径（统一为当前实测，2026-08-24）

- 前端 Vitest：60 文件 / 860 用例
- Rust 后端：332 用例（206 lib 单元 + 126 集成，`cargo test` 实测）
- 桌面 E2E：4 spec（smoke / interaction / distribution-workflow / stats-grid-responsive）

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
