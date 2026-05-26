# Changelog

## v1.0.0 (2026-05-26)

### 新增

#### 核心功能
- 技能库管理：安装/卸载/更新技能（本地文件 + Git 仓库）
- 规则管理：创建/编辑/删除规则（.mdc/.md/.yaml），版本历史
- 标签管理：创建/删除标签，技能和规则标签关联
- 场景编排：创建场景，拖拽添加技能和规则，配置目标平台
- 全局分发：将场景分发到 Claude Code / OpenCode / Cursor
- 项目分发：绑定场景到项目目录，按需分发
- Diff-Based 场景切换：增量同步，无中间空白期
- 漂移检测：Verify & Repair，检测文件系统与 DB 不一致
- 启动完整性检查：后台检测漂移，看板通知

#### 界面与体验
- 看板：全局分发状态、统计卡片、最近活动
- 设置页面：语言切换、数据目录、版本信息、GitHub 链接
- 设置页面-平台管理 Tab：查看已注册平台及路径信息
- 设置页面-技能市场 Tab：占位页面（功能开发中）
- 规则编辑器双栏预览：编辑/预览/双栏三种视图模式切换
- Markdown 规则实时预览（react-markdown + remark-gfm）
- YAML 规则键值对树形展示
- 编辑时 300ms 防抖实时预览更新
- 技能/规则批量删除
- 规则导入功能
- 内联标签编辑
- i18n：中文/英文双语支持

#### 基础设施
- 多平台 CI：macOS + Windows PR 检查，3 平台 Release 手动触发构建
- CSP 安全策略：限制 default-src/img-src/style-src 来源
- tauri.conf.json 平台配置：macOS 最低版本 12.0、Windows 中文安装、Linux deb 依赖
- .editorconfig 统一缩进风格
- CONTRIBUTING.md 贡献指南
- GitHub 开源发布文件：README / LICENSE / CHANGELOG / Issue Templates / CI Workflow

### 改进

- 看板全局分发状态：平台同步状态改为 compact badge 样式
- 看板最近活动：空状态增加引导文案
- 看板最近活动：限制显示最近 5 条，增加安装/移除/错误图标
- 版本号统一为 v1.0.0（package.json / Cargo.toml / tauri.conf.json）
- README 增加"已知限制"一节

### 隐藏

- 技能库安装对话框中"技能市场"选项已隐藏（后端代码保留）