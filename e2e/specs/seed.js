import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invokeTauriCommand } from './tauri.js';

/**
 * E2E 种子技能：让依赖 list_skills 非空的用例在全新 ~/.skillforge 环境下自足。
 *
 * 背景：CI 无数据 seed 步骤、skills 表无内置种子、IPC 层无 create_skill 命令
 * （技能只能经 source plugin 安装）。此前 prepareManagedSkill 直接取
 * list_skills[0]，在全新环境中拿到空列表必然失败。
 *
 * 路径约定来自 LocalFsSource（src-tauri/src/plugins/source/local_fs.rs）：
 * 扫描 ~/.skillforge/sources/local/<skill-id>/SKILL.md；
 * frontmatter 仅要求 name（kebab-case, 1-64 字符）+ description（1-1024 字符）。
 */
export const SEED_SKILL_ID = 'e2e-seed-skill';

const SKILL_MD = [
  '---',
  `name: ${SEED_SKILL_ID}`,
  'description: SkillForge E2E seed skill for distribution workflow tests',
  '---',
  '',
  '# e2e-seed-skill',
  '',
  'Deterministic fixture created by the E2E suite.',
  '',
].join('\n');

function seedSourceDir() {
  return path.join(os.homedir(), '.skillforge', 'sources', 'local', SEED_SKILL_ID);
}

/** 幂等预置 local-fs 技能源目录（Node 侧文件写入）。 */
export function ensureSeedSkillSource() {
  const dir = seedSourceDir();
  const skillMdPath = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(skillMdPath, SKILL_MD);
  }
  return skillMdPath;
}

/** 确保种子技能已安装进数据库并返回其 id。已安装则跳过 install_skill。 */
export async function ensureSeedSkill() {
  ensureSeedSkillSource();
  const skills = await invokeTauriCommand(({ core }) =>
    core.invoke('list_skills')
  );
  if (!Array.isArray(skills) || !skills.some((s) => s.id === SEED_SKILL_ID)) {
    await invokeTauriCommand(
      ({ core }, arg) => core.invoke('install_skill', arg),
      { source: 'local-fs', skillId: SEED_SKILL_ID }
    );
  }
  return SEED_SKILL_ID;
}
