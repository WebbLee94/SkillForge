import type { Tag } from '../types';
import { formatDate } from './utils';

/**
 * Shared pure logic for the Skills / Rules resource-library interaction system
 * (Phase 6 contract §3: 独立模块 + 共享交互/布局系统).
 * Keep this module free of React / Tauri imports so it stays unit-testable.
 */

export type RuleFormat = 'mdc' | 'md' | 'yaml';

export interface ResourceGroup<T> {
  /** null = 未分类 (untagged) group */
  tag: Tag | null;
  items: T[];
}

export type ImportValidationStatus = 'valid' | 'skip' | 'error';

export interface ImportValidation {
  status: ImportValidationStatus;
  reason?: string;
}

/** 导入预览阶段逐项状态（valid 可导入 / skip 已存在或不符合格式 / error 读取或校验失败） */
export type ImportItemStatus = ImportValidationStatus;

/** 导入执行后逐项结果 */
export type ImportResultStatus = 'success' | 'failed' | 'skipped';

/**
 * Group resources by tag for the 分组视图.
 * - 未分类 group always first (tag === null);
 * - a resource with multiple tags appears once per tag group, same object/id (no copy);
 * - untagged resources only appear in the untagged group;
 * - tag groups follow the order of `tags` (module tag list), unknown resource tags
 *   are appended in first-seen order for correctness.
 */
export function groupResourcesByTag<T extends { id: string; tags?: Tag[] }>(
  resources: T[],
  tags: Tag[]
): ResourceGroup<T>[] {
  if (resources.length === 0) return [];

  const orderedTags: Tag[] = [...tags];
  const knownIds = new Set(orderedTags.map((t) => t.id));
  for (const item of resources) {
    for (const tag of item.tags || []) {
      if (!knownIds.has(tag.id)) {
        knownIds.add(tag.id);
        orderedTags.push(tag);
      }
    }
  }

  const groups: ResourceGroup<T>[] = [
    {
      tag: null,
      items: resources.filter((r) => !r.tags || r.tags.length === 0),
    },
    ...orderedTags.map((tag) => ({ tag, items: [] as T[] })),
  ];

  for (const item of resources) {
    for (const tag of item.tags || []) {
      const group = groups.find((g) => g.tag?.id === tag.id);
      if (group) group.items.push(item);
    }
  }

  return groups;
}

/** Inspector 完整时间戳（卡片/列表用相对时间，见 formatDate）。 */
export function formatFullTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 卡片/列表相对时间（不显示「更新于」前缀）——复用 utils.formatDate。 */
export const formatRelativeTime = formatDate;

/** Inspector 标签编辑脏状态：计算保存集合与草稿集合的差异。 */
export function computeTagChanges(
  savedIds: number[],
  draftIds: number[]
): { added: number[]; removed: number[] } {
  const saved = new Set(savedIds);
  const draft = new Set(draftIds);
  return {
    added: draftIds.filter((id) => !saved.has(id)),
    removed: savedIds.filter((id) => !draft.has(id)),
  };
}

export function detectRuleFormat(filename: string): RuleFormat {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'mdc') return 'mdc';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  return 'md';
}

export function ruleImportFileName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

/**
 * 规则导入逐项校验（§3.8）：.md/.mdc 且不重名 → valid；
 * 重名（已存在）或扩展名不支持（不符合格式）→ skip + reason；
 * 读取/写入失败在导入执行阶段标记为 error（组件层）。
 */
export function validateRuleImportFile(
  filename: string,
  existingNames: Set<string>
): ImportValidation {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext !== 'md' && ext !== 'mdc') {
    return { status: 'skip', reason: 'unsupportedFormat' };
  }
  if (existingNames.has(ruleImportFileName(filename))) {
    return { status: 'skip', reason: 'alreadyExists' };
  }
  return { status: 'valid' };
}

export function skillDirName(dirPath: string): string {
  if (!dirPath) return '';
  const parts = dirPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

/**
 * 技能目录导入逐项校验（名称维度，§3.8）。SKILL.md 存在性为异步检查，
 * 由页面在组件层完成（缺失 → skip 不符合格式；读取失败 → error）。
 */
export function validateSkillDirPath(
  dirPath: string,
  existingNames: Set<string>
): ImportValidation {
  const base = skillDirName(dirPath);
  if (!base) return { status: 'error', reason: 'invalidPath' };
  if (existingNames.has(base)) {
    return { status: 'skip', reason: 'alreadyExists' };
  }
  return { status: 'valid' };
}
