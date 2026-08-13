import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Package,
  Plus,
  Search,
  X,
} from 'lucide-react';
import type { Rule, SceneDetail, Skill, Tag } from '../types';
import { TagFilterBar } from './TagFilterBar';
import { useBoundedReveal } from '../lib/useBoundedReveal';

export interface SceneDraft {
  name: string;
  description: string;
  skills: { skill_id: string; enabled: boolean }[];
  rules: { rule_id: string; enabled: boolean }[];
}

interface SceneEditorDrawerProps {
  saved: SceneDetail;
  skills: Skill[];
  rules: Rule[];
  tags: Tag[];
  onSave: (draft: SceneDraft) => Promise<boolean>;
  onClose: () => void;
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

type DraftSkill = SceneDetail['skills'][number];
type DraftRule = SceneDetail['rules'][number];

export function SceneEditorDrawer({
  saved,
  skills,
  rules,
  tags,
  onSave,
  onClose,
}: SceneEditorDrawerProps) {
  const { t } = useTranslation('scenes');
  const { t: tc } = useTranslation('common');

  const [tab, setTab] = useState<'skills' | 'rules'>('skills');
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState<number[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftName, setDraftName] = useState(saved.scene.name);
  const [draftDesc, setDraftDesc] = useState(saved.scene.description || '');
  const [draftSkills, setDraftSkills] = useState<DraftSkill[]>(saved.skills);
  const [draftRules, setDraftRules] = useState<DraftRule[]>(saved.rules);
  const [showUnsaved, setShowUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  const dirty = useMemo(() => {
    if (draftName !== saved.scene.name) return true;
    if (draftDesc !== (saved.scene.description || '')) return true;
    const sk = draftSkills.map((s) => s.skill_id);
    const rk = draftRules.map((r) => r.rule_id);
    const skEnabled = draftSkills.map((s) => s.enabled);
    const rkEnabled = draftRules.map((r) => r.enabled);
    return (
      !arraysEqual(
        sk,
        saved.skills.map((s) => s.skill_id)
      ) ||
      !arraysEqual(
        rk,
        saved.rules.map((r) => r.rule_id)
      ) ||
      !arraysEqual(
        skEnabled,
        saved.skills.map((s) => s.enabled)
      ) ||
      !arraysEqual(
        rkEnabled,
        saved.rules.map((r) => r.enabled)
      )
    );
  }, [draftName, draftDesc, draftSkills, draftRules, saved]);

  const requestClose = () => {
    if (dirty) setShowUnsaved(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showUnsaved) setShowUnsaved(false);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const poolSkills = useMemo(() => {
    const inScene = new Set(draftSkills.map((s) => s.skill_id));
    let list = skills.filter((s) => !inScene.has(s.id));
    const q = search.toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description || '').toLowerCase().includes(q)
      );
    }
    if (tagFilter.length > 0) {
      list = list.filter((s) =>
        s.tags?.some((tag) => tagFilter.includes(tag.id))
      );
    }
    return list;
  }, [skills, draftSkills, search, tagFilter]);

  const poolRules = useMemo(() => {
    const inScene = new Set(draftRules.map((r) => r.rule_id));
    let list = rules.filter((r) => !inScene.has(r.id));
    const q = search.toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q)
      );
    }
    if (tagFilter.length > 0) {
      list = list.filter((r) =>
        r.tags?.some((tag) => tagFilter.includes(tag.id))
      );
    }
    return list;
  }, [rules, draftRules, search, tagFilter]);

  const pool = tab === 'skills' ? poolSkills : poolRules;
  const { revealed, hasMore, revealMore } = useBoundedReveal(pool.length);
  const currentTags = useMemo(
    () =>
      tags.filter(
        (tag) => tag.tag_type === (tab === 'skills' ? 'skill' : 'rule')
      ),
    [tags, tab]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSelected = () => {
    if (tab === 'skills') {
      const toAdd = poolSkills.filter((s) => selectedIds.has(s.id));
      setDraftSkills((prev) => [
        ...prev,
        ...toAdd.map((s, i) => ({
          skill_id: s.id,
          skill_name: s.name,
          version: null,
          enabled: true,
          sort_order: prev.length + i,
        })),
      ]);
    } else {
      const toAdd = poolRules.filter((r) => selectedIds.has(r.id));
      setDraftRules((prev) => [
        ...prev,
        ...toAdd.map((r, i) => ({
          rule_id: r.id,
          rule_name: r.name,
          enabled: true,
          sort_order: prev.length + i,
        })),
      ]);
    }
    setSelectedIds(new Set());
  };

  const move = <T,>(list: T[], index: number, dir: -1 | 1): T[] => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };

  const summary = useMemo(() => {
    const svSk = new Set(saved.skills.map((s) => s.skill_id));
    const sk = draftSkills.map((s) => s.skill_id);
    const addedSkills = sk.filter((id) => !svSk.has(id)).length;
    const removedSkills = saved.skills.filter(
      (s) => !sk.includes(s.skill_id)
    ).length;
    const svR = new Set(saved.rules.map((r) => r.rule_id));
    const rk = draftRules.map((r) => r.rule_id);
    const addedRules = rk.filter((id) => !svR.has(id)).length;
    const removedRules = saved.rules.filter(
      (r) => !rk.includes(r.rule_id)
    ).length;
    const skillsReordered = !arraysEqual(
      saved.skills.map((s) => s.skill_id).filter((id) => sk.includes(id)),
      sk.filter((id) => svSk.has(id))
    );
    const rulesReordered = !arraysEqual(
      saved.rules.map((r) => r.rule_id).filter((id) => rk.includes(id)),
      rk.filter((id) => svR.has(id))
    );
    return {
      addedSkills,
      removedSkills,
      addedRules,
      removedRules,
      reordered: skillsReordered || rulesReordered,
    };
  }, [draftSkills, draftRules, saved]);

  const hasSummary =
    summary.addedSkills > 0 ||
    summary.removedSkills > 0 ||
    summary.addedRules > 0 ||
    summary.removedRules > 0 ||
    summary.reordered;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    const ok = await onSave({
      name: draftName,
      description: draftDesc,
      skills: draftSkills.map((s) => ({
        skill_id: s.skill_id,
        enabled: s.enabled,
      })),
      rules: draftRules.map((r) => ({
        rule_id: r.rule_id,
        enabled: r.enabled,
      })),
    });
    setSaving(false);
    if (ok) onClose();
    else setSaveError(t('drawer.saveFailed'));
  };

  const switchTab = (next: 'skills' | 'rules') => {
    setTab(next);
    setSearch('');
    setTagFilter([]);
    setSelectedIds(new Set());
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('drawer.title', { name: saved.scene.name })}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-background"
      data-testid="scene-drawer"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Package className="h-5 w-5 text-primary" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            {t('drawer.title', { name: saved.scene.name })}
          </h2>
          <p
            className="truncate text-xs text-muted-foreground"
            data-testid="drawer-save-scope-note"
          >
            {t('drawer.saveScopeNote')}
          </p>
        </div>
        <div className="flex-1" />
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={requestClose}
          title={t('drawer.ariaClose')}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: available pool */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-3">
            <div
              role="tablist"
              aria-label={t('drawer.availableSkills')}
              className="flex rounded-lg bg-muted p-0.5"
            >
              <button
                role="tab"
                aria-selected={tab === 'skills'}
                className={cn(
                  'flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  tab === 'skills'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => switchTab('skills')}
              >
                <Package className="mr-1 inline h-3 w-3" />
                {t('drawer.availableSkills')}
              </button>
              <button
                role="tab"
                aria-selected={tab === 'rules'}
                className={cn(
                  'flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
                  tab === 'rules'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                onClick={() => switchTab('rules')}
              >
                <FileText className="mr-1 inline h-3 w-3" />
                {t('drawer.availableRules')}
              </button>
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('drawer.poolSearchPlaceholder')}
                className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="mt-2">
              <TagFilterBar
                tags={currentTags}
                selectedTagIds={tagFilter}
                onToggleTag={(tagId) =>
                  setTagFilter((prev) =>
                    prev.includes(tagId)
                      ? prev.filter((id) => id !== tagId)
                      : [...prev, tagId]
                  )
                }
                onClearAll={() => setTagFilter([])}
                showUntagged={false}
              />
            </div>
            <button
              className={cn(
                'mt-2 flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                selectedIds.size > 0
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'cursor-not-allowed bg-secondary text-secondary-foreground/50'
              )}
              onClick={addSelected}
              disabled={selectedIds.size === 0}
            >
              <Plus className="h-4 w-4" />
              {t('drawer.addSelected')}
              <span className="text-xs">
                {selectedIds.size > 0
                  ? t('drawer.selectedCount', { count: selectedIds.size })
                  : ''}
              </span>
            </button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto p-2"
            data-testid="drawer-pool"
          >
            {pool.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {tc('messages.noData')}
              </p>
            )}
            {pool.slice(0, revealed).map((item) => (
              <label
                key={item.id}
                data-testid="pool-item"
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card p-2 transition-colors hover:bg-accent/50"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="h-4 w-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {'description' in item && item.description
                      ? item.description
                      : 'format' in item
                        ? `.${item.format}`
                        : ''}
                  </span>
                </span>
              </label>
            ))}
            {hasMore && (
              <button
                data-testid="show-more"
                className="flex w-full items-center justify-center gap-1 rounded-md border border-border py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={revealMore}
              >
                {t('drawer.showMore', { count: pool.length - revealed })}
              </button>
            )}
          </div>
        </div>

        {/* Right: current scene draft */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              {t('sceneName')}
            </label>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <label className="mb-1.5 mt-3 block text-sm font-medium text-foreground">
              {t('sceneDescription')}
            </label>
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Package className="h-4 w-4 text-primary" />
            {t('sceneSkills')}
            <span className="text-xs font-normal text-muted-foreground">
              ({draftSkills.length})
            </span>
          </h3>
          <div className="mb-6 space-y-1" data-testid="drawer-current-skills">
            {draftSkills.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                {t('detail.noSkills')}
              </p>
            )}
            {draftSkills.map((skill, index) => (
              <div
                key={skill.skill_id}
                data-testid="scene-member"
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {skill.skill_name || skill.skill_id}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={skill.enabled}
                  data-testid="scene-member-toggle"
                  aria-label={
                    skill.enabled
                      ? t('detail.memberEnabled')
                      : t('detail.memberDisabled')
                  }
                  title={
                    skill.enabled
                      ? t('detail.memberDisabled')
                      : t('detail.memberEnabled')
                  }
                  onClick={() =>
                    setDraftSkills((prev) =>
                      prev.map((s) =>
                        s.skill_id === skill.skill_id
                          ? { ...s, enabled: !s.enabled }
                          : s
                      )
                    )
                  }
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
                    skill.enabled
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-border bg-muted text-muted-foreground'
                  )}
                >
                  {skill.enabled
                    ? t('detail.memberEnabled')
                    : t('detail.memberDisabled')}
                </button>
                <button
                  className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-30"
                  onClick={() =>
                    setDraftSkills((prev) => move(prev, index, -1))
                  }
                  disabled={index === 0}
                  title={t('drawer.moveUp')}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-30"
                  onClick={() => setDraftSkills((prev) => move(prev, index, 1))}
                  disabled={index === draftSkills.length - 1}
                  title={t('drawer.moveDown')}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  className="shrink-0 text-muted-foreground hover:text-error"
                  onClick={() =>
                    setDraftSkills((prev) =>
                      prev.filter((s) => s.skill_id !== skill.skill_id)
                    )
                  }
                  title={t('drawer.remove')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileText className="h-4 w-4 text-success" />
            {t('sceneRules')}
            <span className="text-xs font-normal text-muted-foreground">
              ({draftRules.length})
            </span>
          </h3>
          <div className="mb-6 space-y-1" data-testid="drawer-current-rules">
            {draftRules.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                {t('detail.noRules')}
              </p>
            )}
            {draftRules.map((rule, index) => (
              <div
                key={rule.rule_id}
                data-testid="scene-member"
                className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {rule.rule_name || rule.rule_id}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.enabled}
                  data-testid="scene-member-toggle"
                  aria-label={
                    rule.enabled
                      ? t('detail.memberEnabled')
                      : t('detail.memberDisabled')
                  }
                  title={
                    rule.enabled
                      ? t('detail.memberDisabled')
                      : t('detail.memberEnabled')
                  }
                  onClick={() =>
                    setDraftRules((prev) =>
                      prev.map((r) =>
                        r.rule_id === rule.rule_id
                          ? { ...r, enabled: !r.enabled }
                          : r
                      )
                    )
                  }
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
                    rule.enabled
                      ? 'border-success/40 bg-success/10 text-success'
                      : 'border-border bg-muted text-muted-foreground'
                  )}
                >
                  {rule.enabled
                    ? t('detail.memberEnabled')
                    : t('detail.memberDisabled')}
                </button>
                <button
                  className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-30"
                  onClick={() => setDraftRules((prev) => move(prev, index, -1))}
                  disabled={index === 0}
                  title={t('drawer.moveUp')}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-30"
                  onClick={() => setDraftRules((prev) => move(prev, index, 1))}
                  disabled={index === draftRules.length - 1}
                  title={t('drawer.moveDown')}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  className="shrink-0 text-muted-foreground hover:text-error"
                  onClick={() =>
                    setDraftRules((prev) =>
                      prev.filter((r) => r.rule_id !== rule.rule_id)
                    )
                  }
                  title={t('drawer.remove')}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Changed-state summary */}
          <div
            aria-live="polite"
            data-testid="drawer-summary"
            className="mb-4 rounded-lg border border-border bg-muted/40 p-3"
          >
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t('drawer.summary')}
            </p>
            {!hasSummary && (
              <p className="text-xs text-muted-foreground">
                {t('drawer.summaryEmpty')}
              </p>
            )}
            <div className="flex flex-wrap gap-1.5 text-xs">
              {summary.addedSkills > 0 && (
                <span className="text-success">
                  {t('drawer.summaryAddedSkills', {
                    count: summary.addedSkills,
                  })}
                </span>
              )}
              {summary.removedSkills > 0 && (
                <span className="text-error">
                  {t('drawer.summaryRemovedSkills', {
                    count: summary.removedSkills,
                  })}
                </span>
              )}
              {summary.addedRules > 0 && (
                <span className="text-success">
                  {t('drawer.summaryAddedRules', { count: summary.addedRules })}
                </span>
              )}
              {summary.removedRules > 0 && (
                <span className="text-error">
                  {t('drawer.summaryRemovedRules', {
                    count: summary.removedRules,
                  })}
                </span>
              )}
              {summary.reordered && (
                <span className="text-foreground">
                  {t('drawer.summaryReordered')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {saveError && (
        <div
          role="alert"
          data-testid="drawer-save-error"
          className="border-t border-error/30 bg-error/5 px-4 py-2 text-sm text-error"
        >
          {saveError}
        </div>
      )}

      {/* Footer — primary Save on the left anchor, Cancel after */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button
          className="flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {tc('actions.save')}
        </button>
        <button
          className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={requestClose}
        >
          {tc('actions.cancel')}
        </button>
      </div>

      {/* Unsaved-leave dialog */}
      {showUnsaved && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div
            role="dialog"
            aria-modal="true"
            className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl"
          >
            <h3 className="mb-2 text-base font-semibold text-foreground">
              {t('drawer.unsavedTitle')}
            </h3>
            <p className="mb-6 text-sm text-muted-foreground">
              {t('drawer.unsavedMessage')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                onClick={handleSave}
              >
                {t('drawer.unsavedSave')}
              </button>
              <button
                className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
                onClick={onClose}
              >
                {t('drawer.unsavedDiscard')}
              </button>
              <button
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                onClick={() => setShowUnsaved(false)}
              >
                {t('drawer.unsavedStay')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
