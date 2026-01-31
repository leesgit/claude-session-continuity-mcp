#!/usr/bin/env node
/**
 * Claude Code Hooks 자동 설치 스크립트
 *
 * npm install 시 자동으로 ~/.claude/settings.local.json에 Hook 등록
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.local.json');

// 설치된 패키지 경로 찾기
function getPackagePath(): string {
  // 1. 글로벌 설치 확인
  const globalPath = path.dirname(process.argv[1]);
  if (fs.existsSync(path.join(globalPath, 'hooks'))) {
    return globalPath;
  }

  // 2. 로컬 node_modules 확인
  let current = process.cwd();
  while (current !== path.parse(current).root) {
    const candidate = path.join(current, 'node_modules', 'claude-session-continuity-mcp', 'dist', 'hooks');
    if (fs.existsSync(candidate)) {
      return path.join(current, 'node_modules', 'claude-session-continuity-mcp', 'dist');
    }
    current = path.dirname(current);
  }

  // 3. 현재 패키지 디렉토리 (ESM 호환)
  return path.dirname(__dirname);
}

function loadSettings(): Record<string, unknown> {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSettings(settings: Record<string, unknown>): void {
  if (!fs.existsSync(CLAUDE_DIR)) {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

function install(): void {
  console.log('🔧 Installing Claude Code Hooks for session-continuity...');

  const packagePath = getPackagePath();
  const hooksDir = path.join(packagePath, 'hooks');

  // Hook 스크립트 경로
  const sessionStartHook = path.join(hooksDir, 'session-start.js');
  const userPromptHook = path.join(hooksDir, 'user-prompt-submit.js');

  const settings = loadSettings();

  // 기존 hooks 유지하면서 추가
  const hooks = (settings.hooks as Record<string, unknown[]>) || {};

  // SessionStart Hook
  hooks.SessionStart = [
    {
      hooks: [
        {
          type: 'command',
          command: `node "${sessionStartHook}"`
        }
      ]
    }
  ];

  // UserPromptSubmit Hook
  hooks.UserPromptSubmit = [
    {
      hooks: [
        {
          type: 'command',
          command: `node "${userPromptHook}"`
        }
      ]
    }
  ];

  settings.hooks = hooks;
  saveSettings(settings);

  console.log('✅ Hooks installed successfully!');
  console.log(`   SessionStart: ${sessionStartHook}`);
  console.log(`   UserPromptSubmit: ${userPromptHook}`);
  console.log('');
  console.log('🚀 Restart Claude Code to activate hooks.');
}

function uninstall(): void {
  console.log('🔧 Removing Claude Code Hooks...');

  const settings = loadSettings();
  const hooks = (settings.hooks as Record<string, unknown[]>) || {};

  // session-continuity 관련 Hook만 제거
  delete hooks.SessionStart;
  delete hooks.UserPromptSubmit;

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }

  saveSettings(settings);
  console.log('✅ Hooks removed successfully!');
}

function status(): void {
  console.log('📊 Claude Code Hooks Status\n');

  if (!fs.existsSync(SETTINGS_FILE)) {
    console.log('❌ No hooks configured');
    return;
  }

  const settings = loadSettings();
  const hooks = settings.hooks as Record<string, unknown[]> | undefined;

  if (!hooks) {
    console.log('❌ No hooks configured');
    return;
  }

  console.log('Configured hooks:');
  for (const [event, hookList] of Object.entries(hooks)) {
    console.log(`  ${event}:`);
    for (const hook of hookList as Array<{ hooks: Array<{ command: string }> }>) {
      for (const h of hook.hooks || []) {
        console.log(`    → ${h.command}`);
      }
    }
  }
}

// CLI
const args = process.argv.slice(2);
const command = args[0] || 'install';

switch (command) {
  case 'install':
    install();
    break;
  case 'uninstall':
  case 'remove':
    uninstall();
    break;
  case 'status':
    status();
    break;
  default:
    console.log('Usage: npx claude-session-continuity-hooks [install|uninstall|status]');
}
