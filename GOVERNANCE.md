# SkillForge 项目治理

## 角色

- **Maintainer**：负责架构方向、版本发布、Issue/PR 最终审查和社区规则
- **Core Contributor**：持续参与核心模块开发、审查或维护，可由 Maintainer 授予模块权限
- **Contributor**：通过 Issue、Discussion、文档、测试或代码参与项目
- **Platform Adapter Maintainer**：负责特定 Agent 平台适配器的兼容性和发布质量

## 决策方式

日常实现由对应模块负责人决定。涉及公共 API、数据模型、兼容性、安全策略或版本方向的变更，必须由 Maintainer 确认；重要架构决策记录在 ADR 中。

## Pull Request

所有代码变更通过 Pull Request 合入。PR 必须通过 CI，并完成对应的代码、体验、测试和安全审查。维护者可以要求拆分范围、补充测试或更新文档。

## 版本发布

版本发布由 Maintainer 发起，经过测试、安装包、迁移、文档和安全门禁后发布。破坏性变更使用 SemVer 主版本或明确的迁移说明。

