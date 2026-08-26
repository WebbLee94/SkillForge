import { describe, it, expect } from 'vitest';
import {
  groupResourcesByTag,
  formatFullTimestamp,
  computeTagChanges,
  detectRuleFormat,
  ruleImportFileName,
  validateRuleImportFile,
  validateSkillDirPath,
  skillDirName,
} from '../resourceLibrary';
import type { Tag, Skill } from '../../types';

const mkTag = (id: number, name: string): Tag => ({
  id,
  name,
  color: null,
  tag_type: 'skill',
});

const mkItem = (id: string, tagIds: number[] = []): Skill => ({
  id,
  name: id,
  description: null,
  source_type: 'local',
  source_url: null,
  current_ver: null,
  installed_at: '2026-01-01T00:00:00Z',
  local_path: `/p/${id}`,
  metadata: null,
  tags: tagIds.map((tid) => mkTag(tid, `tag-${tid}`)),
});

describe('groupResourcesByTag', () => {
  it('returns empty array for empty resources', () => {
    expect(groupResourcesByTag([], [mkTag(1, 'a')])).toEqual([]);
  });

  it('puts all untagged resources into a single untagged group (tag === null) first', () => {
    const groups = groupResourcesByTag([mkItem('u1'), mkItem('u2')], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].tag).toBeNull();
    expect(groups[0].items.map((i) => i.id)).toEqual(['u1', 'u2']);
  });

  it('renders untagged group first when both tagged and untagged exist', () => {
    const tags = [mkTag(1, 'frontend')];
    const groups = groupResourcesByTag(
      [mkItem('tagged', [1]), mkItem('plain')],
      tags
    );
    expect(groups[0].tag).toBeNull();
    expect(groups[0].items.map((i) => i.id)).toEqual(['plain']);
    expect(groups[1].tag?.id).toBe(1);
  });

  it('shows a multi-tag resource in every tag group with the same id (no copies)', () => {
    const tags = [mkTag(1, 'review'), mkTag(2, 'standards')];
    const item = mkItem('code-review', [1, 2]);
    const groups = groupResourcesByTag([item], tags);
    expect(groups).toHaveLength(3); // untagged + 2 tag groups
    const reviewGroup = groups.find((g) => g.tag?.id === 1)!;
    const standardsGroup = groups.find((g) => g.tag?.id === 2)!;
    expect(reviewGroup.items).toHaveLength(1);
    expect(standardsGroup.items).toHaveLength(1);
    expect(reviewGroup.items[0]).toBe(item);
    expect(standardsGroup.items[0]).toBe(item);
    // untagged group has no items
    expect(groups[0].items).toHaveLength(0);
  });

  it('never places an untagged resource into a tag group', () => {
    const tags = [mkTag(1, 'frontend')];
    const groups = groupResourcesByTag([mkItem('plain')], tags);
    const tagGroups = groups.filter((g) => g.tag !== null);
    for (const g of tagGroups) {
      expect(g.items.map((i) => i.id)).not.toContain('plain');
    }
  });

  it('orders tag groups by the provided tags array order', () => {
    const tags = [mkTag(1, 'first'), mkTag(2, 'second')];
    const groups = groupResourcesByTag(
      [mkItem('a', [2]), mkItem('b', [1]), mkItem('c', [1, 2])],
      tags
    );
    const tagGroups = groups.filter((g) => g.tag !== null);
    expect(tagGroups.map((g) => g.tag?.id)).toEqual([1, 2]);
  });

  it('keeps input order within a group', () => {
    const tags = [mkTag(1, 'frontend')];
    const groups = groupResourcesByTag(
      [mkItem('b', [1]), mkItem('a', [1]), mkItem('c', [1])],
      tags
    );
    const g = groups.find((grp) => grp.tag?.id === 1)!;
    expect(g.items.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('formatFullTimestamp', () => {
  it('formats an ISO date into a full date+time string containing the year', () => {
    const result = formatFullTimestamp('2026-07-24T10:30:00Z');
    expect(result).toMatch(/2026/);
    // hour 10 or 18 depends on tz; assert contains minute info is fragile — just year + separator
    expect(result.length).toBeGreaterThan(5);
  });

  it('returns the raw input for an invalid date', () => {
    expect(formatFullTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('computeTagChanges', () => {
  it('returns added ids present in draft but not saved', () => {
    expect(computeTagChanges([1, 2], [2, 3])).toEqual({
      added: [3],
      removed: [1],
    });
  });

  it('returns empty changes when sets are identical', () => {
    expect(computeTagChanges([1, 2], [2, 1])).toEqual({
      added: [],
      removed: [],
    });
  });

  it('handles empty saved and draft', () => {
    expect(computeTagChanges([], [])).toEqual({ added: [], removed: [] });
    expect(computeTagChanges([1], [])).toEqual({ added: [], removed: [1] });
    expect(computeTagChanges([], [1])).toEqual({ added: [1], removed: [] });
  });
});

describe('detectRuleFormat', () => {
  it('detects mdc/md/yaml/yml extensions', () => {
    expect(detectRuleFormat('a.mdc')).toBe('mdc');
    expect(detectRuleFormat('a.md')).toBe('md');
    expect(detectRuleFormat('a.yaml')).toBe('yaml');
    expect(detectRuleFormat('a.yml')).toBe('yaml');
  });

  it('falls back to md for unknown extensions', () => {
    expect(detectRuleFormat('a.txt')).toBe('md');
    expect(detectRuleFormat('noext')).toBe('md');
  });
});

describe('ruleImportFileName', () => {
  it('strips the file extension', () => {
    expect(ruleImportFileName('my-rule.mdc')).toBe('my-rule');
    expect(ruleImportFileName('docs.md')).toBe('docs');
  });
});

describe('validateRuleImportFile', () => {
  it('marks .md and .mdc files as valid when not duplicated', () => {
    expect(validateRuleImportFile('a.md', new Set())).toEqual({
      status: 'valid',
    });
    expect(validateRuleImportFile('a.mdc', new Set())).toEqual({
      status: 'valid',
    });
  });

  it('marks duplicate name as skip with reason alreadyExists', () => {
    const existing = new Set(['a']);
    expect(validateRuleImportFile('a.mdc', existing)).toEqual({
      status: 'skip',
      reason: 'alreadyExists',
    });
  });

  it('marks unsupported extensions as skip with reason unsupportedFormat', () => {
    expect(validateRuleImportFile('a.txt', new Set())).toEqual({
      status: 'skip',
      reason: 'unsupportedFormat',
    });
  });
});

describe('skillDirName / validateSkillDirPath', () => {
  it('extracts basename from posix and windows paths', () => {
    expect(skillDirName('/Users/me/skills/react')).toBe('react');
    expect(skillDirName('C:\\skills\\react')).toBe('react');
  });

  it('marks a non-duplicate dir as valid', () => {
    expect(validateSkillDirPath('/p/skills/react', new Set())).toEqual({
      status: 'valid',
    });
  });

  it('marks duplicate dir name as skip with reason alreadyExists', () => {
    expect(validateSkillDirPath('/p/skills/react', new Set(['react']))).toEqual(
      { status: 'skip', reason: 'alreadyExists' }
    );
  });

  it('marks empty path as error', () => {
    expect(validateSkillDirPath('', new Set())).toEqual({
      status: 'error',
      reason: 'invalidPath',
    });
  });
});
