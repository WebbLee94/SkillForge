# Changelog

## v1.0.1 (2026-06-10)

### 修复

#### 分发同步
- 全局分发同步后状态显示为"已同步"（修复 distributions 表多行 GROUP BY 歧义导致 status 取旧值）
- 项目分发同步后平台图标显示为绿勾（修复 dist_engine status 列误写 datetime 字符串）
- Directory 模式规则同步增加 diff 删除，统一为完整 diff 策略（技能+规则行为一致）

#### 技能库
- 覆盖安装不再丢失标签和场景关系（DELETE CASCADE → UPDATE 保护外键关联）
- 批量安装支持子目录深度复制（动态扫描所有子目录 + copy_dir_recursive）
- 批量安装界面增加滚动条、合并 Toast 结果、使用后端 batch 命令
- 暂时隐藏 Git 安装选项（逻辑待修复后开放）

#### 看板 / 全局分发
- 看板与全局分发场景选择保持一致（修复 useEffect 依赖死锁）
- xx/xx 格式改为"已安装技能数 / 已同步规则数"

#### 规则管理
- 删除规则后标签计数同步更新
- 新建规则默认格式改为 `.md` 并排在第一位

#### 设置
- GitHub 链接修正为 `github.com/WebbLee94/SkillForge`
- 新增分发方式说明文案（解释技能 symlink vs 规则 copy 的差异原因）

### 文档
- README.md 添加致谢节（引用 skills-manager）
- CHANGELOG.md 更新至 v1.0.1

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
