/**
 * 共享 UI 样式令牌（决策 9：全局搜索/select 控件一致性）。
 *
 * 技能/规则/项目三页搜索框统一复用 SEARCH_INPUT_CLASSES；
 * 工作区（DistributionWorkspace）与设置（Settings）的 select 统一复用 SELECT_CLASSES。
 * 修改控件样式时优先调整这里的令牌，避免各页分散的内联 class 漂移。
 */
export const SEARCH_INPUT_CLASSES =
  'w-full max-w-[220px] rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

export const SELECT_CLASSES =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
