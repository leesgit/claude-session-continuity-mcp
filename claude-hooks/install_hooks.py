#!/usr/bin/env python3
"""
Claude Hooks 설치 스크립트

Project Manager MCP의 자동 컨텍스트 로드/저장 기능을
Claude Code hooks에 등록합니다.

사용법:
    python install_hooks.py          # 설치
    python install_hooks.py --remove # 제거
"""

import json
import os
import sys
import shutil
from pathlib import Path

# 경로 설정
SCRIPT_DIR = Path(__file__).parent.absolute()
CLAUDE_SETTINGS_PATH = Path.home() / '.claude' / 'settings.json'
CLAUDE_SETTINGS_LOCAL = Path.home() / '.claude' / 'settings.local.json'

def get_hooks_config() -> dict:
    """hooks 설정 생성"""
    pre_hook = str(SCRIPT_DIR / 'pre_prompt_submit.py')
    post_hook = str(SCRIPT_DIR / 'post_prompt_submit.py')

    return {
        "hooks": {
            "PreToolUse": [],
            "PostToolUse": [],
            "Notification": [],
            "Stop": [],
            "SubagentStop": []
        },
        # Claude Code의 user-prompt-submit hook 사용
        # 참고: 정확한 hook 이름은 Claude Code 버전에 따라 다를 수 있음
    }

def load_settings(path: Path) -> dict:
    """설정 파일 로드"""
    if path.exists():
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_settings(path: Path, settings: dict):
    """설정 파일 저장"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)

def install_hooks():
    """hooks 설치"""
    print("🔧 Installing Project Manager MCP Hooks...")

    # 현재 설정 로드
    settings = load_settings(CLAUDE_SETTINGS_LOCAL)

    # hooks 섹션 확인/생성
    if 'hooks' not in settings:
        settings['hooks'] = {}

    # user-prompt-submit hook 추가 (pre_prompt_submit.py)
    pre_hook_cmd = f"python3 {SCRIPT_DIR / 'pre_prompt_submit.py'}"

    if 'user-prompt-submit' not in settings['hooks']:
        settings['hooks']['user-prompt-submit'] = []

    # 중복 체크
    existing_cmds = [h.get('command', '') if isinstance(h, dict) else h
                     for h in settings['hooks']['user-prompt-submit']]

    if pre_hook_cmd not in existing_cmds and 'pre_prompt_submit.py' not in str(existing_cmds):
        settings['hooks']['user-prompt-submit'].append({
            "command": pre_hook_cmd
        })
        print(f"  ✅ Added pre_prompt_submit hook")
    else:
        print(f"  ℹ️  pre_prompt_submit hook already exists")

    # 저장
    save_settings(CLAUDE_SETTINGS_LOCAL, settings)

    print(f"\n✅ Hooks installed to: {CLAUDE_SETTINGS_LOCAL}")
    print("\n📋 설정된 Hook:")
    print(f"   • user-prompt-submit: 세션 시작 시 컨텍스트 자동 로드")
    print("\n💡 비활성화하려면: MCP_HOOKS_DISABLED=true 환경변수 설정")
    print("💡 제거하려면: python install_hooks.py --remove")

def remove_hooks():
    """hooks 제거"""
    print("🔧 Removing Project Manager MCP Hooks...")

    settings = load_settings(CLAUDE_SETTINGS_LOCAL)

    if 'hooks' not in settings:
        print("  ℹ️  No hooks found")
        return

    # pre_prompt_submit.py 관련 hook 제거
    if 'user-prompt-submit' in settings['hooks']:
        original_len = len(settings['hooks']['user-prompt-submit'])
        settings['hooks']['user-prompt-submit'] = [
            h for h in settings['hooks']['user-prompt-submit']
            if 'pre_prompt_submit.py' not in str(h)
        ]
        removed = original_len - len(settings['hooks']['user-prompt-submit'])
        if removed > 0:
            print(f"  ✅ Removed {removed} hook(s)")
        else:
            print("  ℹ️  No matching hooks found")

    save_settings(CLAUDE_SETTINGS_LOCAL, settings)
    print(f"\n✅ Hooks removed from: {CLAUDE_SETTINGS_LOCAL}")

def show_status():
    """현재 hook 상태 표시"""
    print("📋 Current Hook Status\n")

    settings = load_settings(CLAUDE_SETTINGS_LOCAL)

    if 'hooks' not in settings or not settings['hooks']:
        print("  No hooks configured")
        return

    for hook_name, hooks in settings['hooks'].items():
        if hooks:
            print(f"  {hook_name}:")
            for h in hooks:
                cmd = h.get('command', h) if isinstance(h, dict) else h
                print(f"    • {cmd}")

def main():
    """메인"""
    args = sys.argv[1:]

    if '--remove' in args or '-r' in args:
        remove_hooks()
    elif '--status' in args or '-s' in args:
        show_status()
    elif '--help' in args or '-h' in args:
        print(__doc__)
    else:
        install_hooks()

if __name__ == '__main__':
    main()
