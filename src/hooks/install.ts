#!/usr/bin/env node
/**
 * Claude Code Hooks + MCP Server 자동 설치 스크립트
 *
 * npm install 시 자동으로:
 * 1. ~/.claude/settings.json에 Hook 등록
 * 2. ~/.claude.json에 MCP 서버 등록
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
const LEGACY_SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.local.json');
const MCP_CONFIG_FILE = path.join(os.homedir(), '.claude.json');

// Codex CLI (2026-07-09): hooks register in ~/.codex/hooks.json (same JSON shape as Claude)
const CODEX_DIR = path.join(os.homedir(), '.codex');
const CODEX_HOOKS_FILE = path.join(CODEX_DIR, 'hooks.json');

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

function migrateLegacyHooks(): void {
  if (!fs.existsSync(LEGACY_SETTINGS_FILE)) return;

  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY_SETTINGS_FILE, 'utf-8'));
    const legacyHooks = legacy.hooks;
    if (!legacyHooks) return;

    // Remove hooks from legacy file
    delete legacy.hooks;
    if (Object.keys(legacy).length === 0 || (Object.keys(legacy).length === 1 && legacy.permissions)) {
      // Only permissions left or empty - can clean up
      fs.writeFileSync(LEGACY_SETTINGS_FILE, JSON.stringify(legacy, null, 2));
    } else {
      fs.writeFileSync(LEGACY_SETTINGS_FILE, JSON.stringify(legacy, null, 2));
    }

    console.log('🔄 Migrated hooks from settings.local.json → settings.json');
  } catch {
    // Ignore migration errors
  }
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

function loadMcpConfig(): Record<string, unknown> {
  if (!fs.existsSync(MCP_CONFIG_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(MCP_CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveMcpConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function installMcpServer(): boolean {
  console.log('🔧 Registering MCP server...');

  try {
    const config = loadMcpConfig();
    const mcpServers = (config.mcpServers as Record<string, unknown>) || {};

    // 이미 등록되어 있으면 스킵
    if (mcpServers['project-manager']) {
      console.log('   MCP server already registered');
      return true;
    }

    // MCP 서버 등록
    mcpServers['project-manager'] = {
      command: 'npx',
      args: ['claude-session-continuity-mcp']
    };

    config.mcpServers = mcpServers;
    saveMcpConfig(config);

    console.log('✅ MCP server registered in ~/.claude.json');
    return true;
  } catch (error) {
    console.error('⚠️ Failed to register MCP server:', error);
    console.log('   You can manually add to ~/.claude.json:');
    console.log('   {');
    console.log('     "mcpServers": {');
    console.log('       "project-manager": {');
    console.log('         "command": "npx",');
    console.log('         "args": ["claude-session-continuity-mcp"]');
    console.log('       }');
    console.log('     }');
    console.log('   }');
    return false;
  }
}

/**
 * Register the same hooks in ~/.codex/hooks.json for OpenAI Codex CLI (2026-07-09).
 * Only runs if ~/.codex exists (Codex installed). Preserves user's existing hooks;
 * replaces only ours (matched by the claude-hook- command prefix).
 */
function installCodexHooks(): void {
  if (!fs.existsSync(CODEX_DIR)) return;  // Codex not installed -> skip silently

  const OUR_PREFIX = 'claude-hook-';
  let hooksConfig: { hooks?: Record<string, unknown[]> } = { hooks: {} };
  if (fs.existsSync(CODEX_HOOKS_FILE)) {
    try { hooksConfig = JSON.parse(fs.readFileSync(CODEX_HOOKS_FILE, 'utf-8')); }
    catch { hooksConfig = { hooks: {} }; }
  }
  const hooks = hooksConfig.hooks || {};

  const merge = (event: string, ourEntries: unknown[]): void => {
    const existing = (hooks[event] || []) as Array<{ hooks?: Array<{ command?: string }> }>;
    const userEntries = existing.filter(e =>
      !(e.hooks || []).some(h => h.command && h.command.includes(OUR_PREFIX)));
    hooks[event] = [...userEntries, ...ourEntries];
  };

  // Codex uses the same event names as Claude (SessionStart/UserPromptSubmit/Stop...).
  // Append "--codex" so hooks detect the host reliably: Codex passes transcript_path
  // as null at SessionStart, so the argv marker is the only dependable signal.
  merge('SessionStart', [{ hooks: [{ type: 'command', command: 'npm exec -- claude-hook-session-start --codex' }] }]);
  merge('UserPromptSubmit', [{ hooks: [{ type: 'command', command: 'npm exec -- claude-hook-user-prompt --codex' }] }]);
  merge('PreCompact', [{ hooks: [{ type: 'command', command: 'npm exec -- claude-hook-pre-compact --codex' }] }]);
  merge('Stop', [{ hooks: [{ type: 'command', command: 'npm exec -- claude-hook-session-end --codex' }] }]);

  hooksConfig.hooks = hooks;
  try {
    fs.writeFileSync(CODEX_HOOKS_FILE, JSON.stringify(hooksConfig, null, 2));
    console.log('✅ Codex CLI hooks installed (~/.codex/hooks.json)');
  } catch { /* non-fatal: Codex hooks are optional */ }
}

function install(): void {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   Claude Session Continuity MCP - Installation             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // ===== 0. Migrate from settings.local.json if needed =====
  migrateLegacyHooks();

  // ===== 1. Hooks 설치 (npm exec 방식 - 경로 독립적) =====
  console.log('📌 Step 1: Installing Hooks (npm exec mode)...');

  const settings = loadSettings();

  // 기존 hooks 유지하면서 우리 훅만 추가/교체
  const hooks = (settings.hooks as Record<string, unknown[]>) || {};

  // 우리 훅 명령어 prefix (이걸로 우리 훅인지 판별)
  const OUR_PREFIX = 'claude-hook-';

  /**
   * 기존 훅 배열에서 우리 훅만 제거하고, 새 훅을 추가
   * 사용자 커스텀 훅은 보존됨
   */
  function mergeHooks(event: string, ourEntries: unknown[]): void {
    const existing = (hooks[event] || []) as Array<{ hooks?: Array<{ command?: string }>; matcher?: string }>;

    // 기존 항목 중 우리 훅이 아닌 것만 보존
    const userEntries = existing.filter(entry => {
      const cmds = entry.hooks || [];
      return !cmds.some(h => h.command && h.command.includes(OUR_PREFIX));
    });

    // 사용자 훅 먼저, 우리 훅 뒤에 추가
    hooks[event] = [...userEntries, ...ourEntries];
  }

  mergeHooks('SessionStart', [
    { hooks: [{ type: 'command', command: 'npm exec -- claude-hook-session-start' }] }
  ]);

  mergeHooks('UserPromptSubmit', [
    { hooks: [{ type: 'command', command: 'npm exec -- claude-hook-user-prompt' }] }
  ]);

  mergeHooks('PostToolUse', [
    { matcher: 'Edit', hooks: [{ type: 'command', command: 'npm exec -- claude-hook-post-tool' }] },
    { matcher: 'Write', hooks: [{ type: 'command', command: 'npm exec -- claude-hook-post-tool' }] }
  ]);

  mergeHooks('PreCompact', [
    { hooks: [{ type: 'command', command: 'npm exec -- claude-hook-pre-compact' }] }
  ]);

  mergeHooks('Stop', [
    { hooks: [{ type: 'command', command: 'npm exec -- claude-hook-session-end' }] }
  ]);

  settings.hooks = hooks;
  saveSettings(settings);

  // Codex CLI hooks (2026-07-09): register the same hooks in ~/.codex/hooks.json
  // if Codex is present. Hooks auto-detect the host and emit the right output format.
  installCodexHooks();

  console.log('✅ Hooks installed (npm exec mode - works with local or global install!)');
  console.log('   SessionStart: context auto-load');
  console.log('   UserPromptSubmit: relevant memory injection');
  console.log('   PostToolUse: file change tracking (Edit, Write)');
  console.log('   PreCompact: save before context compression');
  console.log('   Stop: auto-save session on exit');
  console.log('');

  // ===== 2. MCP 서버 등록 =====
  console.log('📌 Step 2: Registering MCP Server...');
  installMcpServer();
  console.log('');

  // ===== 완료 메시지 =====
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   ✅ Installation Complete!                                ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║                                                            ║');
  console.log('║   🚀 Restart Claude Code to activate:                      ║');
  console.log('║      - 24 MCP tools (session_start, memory_store, etc.)    ║');
  console.log('║      - Auto context injection on session start             ║');
  console.log('║                                                            ║');
  console.log('║   📖 Quick Start:                                          ║');
  console.log('║      1. Start a new Claude Code session                    ║');
  console.log('║      2. Context will be auto-injected                      ║');
  console.log('║      3. Use session_end to save context                    ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
}

function uninstall(): void {
  console.log('🔧 Removing Claude Code Hooks...');

  const settings = loadSettings();
  const hooks = (settings.hooks as Record<string, unknown[]>) || {};
  const OUR_PREFIX = 'claude-hook-';

  // 각 이벤트에서 우리 훅만 제거, 사용자 훅은 보존
  for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PreCompact', 'Stop']) {
    const existing = (hooks[event] || []) as Array<{ hooks?: Array<{ command?: string }> }>;
    const remaining = existing.filter(entry => {
      const cmds = entry.hooks || [];
      return !cmds.some(h => h.command && h.command.includes(OUR_PREFIX));
    });

    if (remaining.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = remaining;
    }
  }

  if (Object.keys(hooks).length === 0) {
    delete settings.hooks;
  } else {
    settings.hooks = hooks;
  }

  saveSettings(settings);

  // Also remove our hooks from Codex (2026-07-09), preserving user's hooks.
  if (fs.existsSync(CODEX_HOOKS_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CODEX_HOOKS_FILE, 'utf-8')) as { hooks?: Record<string, unknown[]> };
      const ch = cfg.hooks || {};
      for (const event of ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'Stop']) {
        const existing = (ch[event] || []) as Array<{ hooks?: Array<{ command?: string }> }>;
        const remaining = existing.filter(e => !(e.hooks || []).some(h => h.command && h.command.includes(OUR_PREFIX)));
        if (remaining.length === 0) delete ch[event]; else ch[event] = remaining;
      }
      cfg.hooks = ch;
      fs.writeFileSync(CODEX_HOOKS_FILE, JSON.stringify(cfg, null, 2));
    } catch { /* non-fatal */ }
  }

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
