#!/usr/bin/env node
/**
 * Claude Code Hooks + MCP Server 자동 설치 스크립트
 *
 * npm install 시 자동으로:
 * 1. ~/.claude/settings.local.json에 Hook 등록
 * 2. ~/.claude.json에 MCP 서버 등록
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.local.json');
const MCP_CONFIG_FILE = path.join(os.homedir(), '.claude.json');

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

function install(): void {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   Claude Session Continuity MCP - Installation             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // ===== 1. Hooks 설치 (npm exec 방식 - 경로 독립적) =====
  console.log('📌 Step 1: Installing Hooks (npm exec mode)...');

  const settings = loadSettings();

  // 기존 hooks 유지하면서 추가
  const hooks = (settings.hooks as Record<string, unknown[]>) || {};

  // SessionStart Hook - 세션 시작 시 컨텍스트 로드
  hooks.SessionStart = [
    {
      hooks: [
        {
          type: 'command',
          command: 'npm exec -- claude-hook-session-start'
        }
      ]
    }
  ];

  // UserPromptSubmit Hook - 프롬프트 제출 시 관련 컨텍스트 주입
  hooks.UserPromptSubmit = [
    {
      hooks: [
        {
          type: 'command',
          command: 'npm exec -- claude-hook-user-prompt'
        }
      ]
    }
  ];

  // PostToolUse Hook - 파일 변경 시 자동 기록 (Edit, Write)
  hooks.PostToolUse = [
    {
      matcher: {
        tool_name: 'Edit|Write'
      },
      hooks: [
        {
          type: 'command',
          command: 'npm exec -- claude-hook-post-tool'
        }
      ]
    }
  ];

  // PreCompact Hook - 컨텍스트 압축 전 중요 정보 저장
  hooks.PreCompact = [
    {
      hooks: [
        {
          type: 'command',
          command: 'npm exec -- claude-hook-pre-compact'
        }
      ]
    }
  ];

  // Stop Hook - 세션 종료 시 자동 저장
  hooks.Stop = [
    {
      hooks: [
        {
          type: 'command',
          command: 'npm exec -- claude-hook-session-end'
        }
      ]
    }
  ];

  settings.hooks = hooks;
  saveSettings(settings);

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

  // session-continuity 관련 Hook만 제거
  delete hooks.SessionStart;
  delete hooks.UserPromptSubmit;
  delete hooks.PostToolUse;
  delete hooks.PreCompact;
  delete hooks.Stop;

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
