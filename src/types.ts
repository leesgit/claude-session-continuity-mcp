// 공통 타입 정의
import type { CallToolResult as SDKCallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// SDK의 CallToolResult를 그대로 사용
export type CallToolResult = SDKCallToolResult;

// 텍스트 응답 헬퍼 함수
export function textResult(text: string, isError?: boolean): CallToolResult {
  return {
    content: [{ type: 'text' as const, text }],
    isError
  };
}

// 자동 학습 Args
export interface AutoLearnDecisionArgs {
  project: string;
  decision: string;
  reason: string;
  context?: string;
  alternatives?: string[];
  files?: string[];
}

export interface AutoLearnFixArgs {
  project: string;
  error: string;
  solution: string;
  cause?: string;
  files?: string[];
  preventionTip?: string;
}

export interface AutoLearnPatternArgs {
  project: string;
  patternName: string;
  description: string;
  example?: string;
  appliesTo?: string;
}

export interface AutoLearnDependencyArgs {
  project: string;
  dependency: string;
  action: 'add' | 'remove' | 'upgrade' | 'downgrade';
  reason: string;
  fromVersion?: string;
  toVersion?: string;
  breakingChanges?: string;
}

// Content Filter Pattern
export interface ContentFilterPattern {
  id: number;
  patternType: string;
  patternDescription: string;
  fileExtension: string | null;
  mitigationStrategy: string | null;
}
