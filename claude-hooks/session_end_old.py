#!/usr/bin/env python3
"""
Claude Code Stop Hook
Claude 응답 완료 시 세션 종료 알림을 표시합니다.
"""

import json
import sys
import os

def main():
    try:
        # stdin에서 hook 데이터 읽기
        input_data = json.load(sys.stdin)
        cwd = input_data.get("cwd", os.getcwd())

        # stop_reason 확인 (사용자가 대화 종료 의도인지)
        # 일반적인 응답 완료 시에는 알림 생략

        # 프로젝트 이름 추출
        project_name = None
        if "/apps/" in cwd:
            parts = cwd.split("/apps/")
            if len(parts) > 1:
                project_name = parts[1].split("/")[0]
        else:
            project_name = os.path.basename(cwd)

        # 세션 저장 리마인더 (매번 표시하면 피로하므로 조건부)
        # 실제로는 Claude가 대화 흐름에서 판단하도록 함

        sys.exit(0)

    except Exception as e:
        sys.exit(0)

if __name__ == "__main__":
    main()
