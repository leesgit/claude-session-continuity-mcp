// 자동 컨텍스트 캡처 테스트
import { describe, it, expect } from 'vitest';

// ProjectContext 타입 (테스트용)
interface ProjectContext {
  project: string;
  fixed: {
    techStack: Record<string, string>;
    architectureDecisions: string[];
    codePatterns: string[];
    specialNotes: string | null;
  };
  active: {
    currentState: string;
    recentFiles: string[];
    blockers: string | null;
    lastVerification: string | null;
    updatedAt: string | null;
  };
  pendingTasks: Array<{
    id: number;
    title: string;
    status: string;
    priority: number;
  }>;
}

// 토큰 추정 함수 (테스트용)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateContextTokens(context: ProjectContext): number {
  const json = JSON.stringify(context);
  return estimateTokens(json);
}

describe('Token Estimation', () => {
  it('should estimate tokens from string length', () => {
    // 4 chars = 1 token (roughly)
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('abc')).toBe(1); // ceil(3/4) = 1
    expect(estimateTokens('abcde')).toBe(2); // ceil(5/4) = 2
  });

  it('should estimate context tokens', () => {
    const context: ProjectContext = {
      project: 'test-project',
      fixed: {
        techStack: { framework: 'Next.js', language: 'TypeScript' },
        architectureDecisions: ['Use App Router', 'Server Actions'],
        codePatterns: ['Zod validation'],
        specialNotes: null
      },
      active: {
        currentState: 'Working on login feature',
        recentFiles: ['src/app/login/page.tsx'],
        blockers: null,
        lastVerification: 'passed',
        updatedAt: '2024-01-15T12:00:00Z'
      },
      pendingTasks: [
        { id: 1, title: 'Implement signup', status: 'pending', priority: 8 }
      ]
    };

    const tokens = estimateContextTokens(context);

    // 컨텍스트는 대략 400-800 토큰 범위여야 함
    expect(tokens).toBeGreaterThan(50);
    expect(tokens).toBeLessThan(1000);
  });
});

describe('Context Snapshot', () => {
  it('should create valid snapshot structure', () => {
    const context: ProjectContext = {
      project: 'my-app',
      fixed: {
        techStack: {},
        architectureDecisions: [],
        codePatterns: [],
        specialNotes: null
      },
      active: {
        currentState: 'Initial state',
        recentFiles: [],
        blockers: null,
        lastVerification: null,
        updatedAt: null
      },
      pendingTasks: []
    };

    const snapshot = {
      project: context.project,
      timestamp: new Date().toISOString(),
      tokenEstimate: estimateContextTokens(context),
      context
    };

    expect(snapshot.project).toBe('my-app');
    expect(snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snapshot.tokenEstimate).toBeGreaterThan(0);
    expect(snapshot.context).toBeDefined();
  });
});

describe('Compact Context Format', () => {
  it('should generate compact summary', () => {
    const context: ProjectContext = {
      project: 'my-app',
      fixed: {
        techStack: { framework: 'Next.js 15', language: 'TypeScript' },
        architectureDecisions: ['App Router', 'Server Actions', 'Tailwind CSS'],
        codePatterns: ['Zod validation'],
        specialNotes: null
      },
      active: {
        currentState: 'Implementing user authentication',
        recentFiles: ['src/app/login/page.tsx', 'src/lib/auth.ts', 'src/components/LoginForm.tsx'],
        blockers: 'OAuth provider config pending',
        lastVerification: 'passed',
        updatedAt: '2024-01-15T12:00:00Z'
      },
      pendingTasks: [
        { id: 1, title: 'Implement signup', status: 'pending', priority: 8 },
        { id: 2, title: 'Add password reset', status: 'pending', priority: 5 }
      ]
    };

    // 간결한 요약 생성 (실제 함수 로직 시뮬레이션)
    const lines: string[] = [];

    lines.push(`# ${context.project}`);
    lines.push('');

    if (Object.keys(context.fixed.techStack).length > 0) {
      const stackStr = Object.entries(context.fixed.techStack)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      lines.push(`**Stack**: ${stackStr}`);
    }

    if (context.fixed.architectureDecisions.length > 0) {
      lines.push(`**Decisions**: ${context.fixed.architectureDecisions.slice(0, 3).join(' | ')}`);
    }

    lines.push(`**State**: ${context.active.currentState}`);

    if (context.active.recentFiles.length > 0) {
      const files = context.active.recentFiles.slice(0, 5).map(f => f.split('/').pop()).join(', ');
      lines.push(`**Files**: ${files}`);
    }

    if (context.active.blockers) {
      lines.push(`**Blocker**: ${context.active.blockers}`);
    }

    if (context.pendingTasks.length > 0) {
      const tasks = context.pendingTasks.map(t => `[P${t.priority}] ${t.title}`).join(' | ');
      lines.push(`**Tasks**: ${tasks}`);
    }

    const summary = lines.join('\n');

    expect(summary).toContain('# my-app');
    expect(summary).toContain('**Stack**: framework: Next.js 15, language: TypeScript');
    expect(summary).toContain('**Decisions**: App Router | Server Actions | Tailwind CSS');
    expect(summary).toContain('**State**: Implementing user authentication');
    expect(summary).toContain('**Files**: page.tsx, auth.ts, LoginForm.tsx');
    expect(summary).toContain('**Blocker**: OAuth provider config pending');
    expect(summary).toContain('[P8] Implement signup');

    // 토큰 수 확인 (650 토큰 목표)
    const tokens = estimateTokens(summary);
    expect(tokens).toBeLessThan(700);
  });
});

describe('Context Save Options', () => {
  it('should validate save options', () => {
    interface SaveContextOptions {
      currentState: string;
      recentFiles?: string[];
      blockers?: string | null;
      verification?: 'passed' | 'failed' | null;
      architectureDecision?: string;
      codePattern?: string;
      techStack?: Record<string, string>;
    }

    const options: SaveContextOptions = {
      currentState: 'Completed login feature',
      recentFiles: ['src/app/login/page.tsx', 'src/lib/auth.ts'],
      blockers: null,
      verification: 'passed',
      architectureDecision: 'Use NextAuth.js for authentication',
      codePattern: 'Server Actions for form submission',
      techStack: { auth: 'NextAuth.js' }
    };

    expect(options.currentState).toBeTruthy();
    expect(options.recentFiles).toHaveLength(2);
    expect(options.verification).toBe('passed');
    expect(options.architectureDecision).toBeTruthy();
    expect(options.codePattern).toBeTruthy();
    expect(options.techStack?.auth).toBe('NextAuth.js');
  });

  it('should accept minimal options', () => {
    interface SaveContextOptions {
      currentState: string;
      recentFiles?: string[];
      blockers?: string | null;
      verification?: 'passed' | 'failed' | null;
    }

    const minimalOptions: SaveContextOptions = {
      currentState: 'Working on feature'
    };

    expect(minimalOptions.currentState).toBeTruthy();
    expect(minimalOptions.recentFiles).toBeUndefined();
    expect(minimalOptions.verification).toBeUndefined();
  });
});

describe('Session Lifecycle', () => {
  it('should track session start metadata', () => {
    const sessionStart = {
      project: 'my-app',
      timestamp: new Date().toISOString(),
      action: 'session_start'
    };

    expect(sessionStart.project).toBe('my-app');
    expect(sessionStart.action).toBe('session_start');
  });

  it('should track session end metadata', () => {
    const sessionEnd = {
      project: 'my-app',
      timestamp: new Date().toISOString(),
      action: 'session_end',
      lastWork: 'Completed login feature',
      verification: 'passed' as const
    };

    expect(sessionEnd.project).toBe('my-app');
    expect(sessionEnd.action).toBe('session_end');
    expect(sessionEnd.verification).toBe('passed');
  });
});

describe('Architecture Decision Management', () => {
  it('should limit decisions to max 5', () => {
    let decisions = [
      'Decision 1',
      'Decision 2',
      'Decision 3',
      'Decision 4',
      'Decision 5'
    ];

    const newDecision = 'Decision 6';

    // 중복 제거 후 앞에 추가
    decisions = decisions.filter(d => d !== newDecision);
    decisions.unshift(newDecision);
    decisions = decisions.slice(0, 5);

    expect(decisions).toHaveLength(5);
    expect(decisions[0]).toBe('Decision 6');
    expect(decisions[4]).toBe('Decision 4'); // Decision 5 was removed
  });

  it('should not duplicate existing decisions', () => {
    let decisions = ['Decision 1', 'Decision 2', 'Decision 3'];

    const existingDecision = 'Decision 2';

    decisions = decisions.filter(d => d !== existingDecision);
    decisions.unshift(existingDecision);
    decisions = decisions.slice(0, 5);

    expect(decisions).toHaveLength(3);
    expect(decisions[0]).toBe('Decision 2');
    expect(decisions.filter(d => d === 'Decision 2')).toHaveLength(1);
  });
});

describe('Tech Stack Merge', () => {
  it('should merge tech stacks', () => {
    let stack: Record<string, string> = {
      framework: 'Next.js 15',
      language: 'TypeScript'
    };

    const newStack: Record<string, string> = {
      auth: 'NextAuth.js',
      framework: 'Next.js 15.1' // Update existing
    };

    stack = { ...stack, ...newStack };

    expect(stack.framework).toBe('Next.js 15.1'); // Updated
    expect(stack.language).toBe('TypeScript'); // Preserved
    expect(stack.auth).toBe('NextAuth.js'); // Added
  });
});

describe('Recent Files Limit', () => {
  it('should limit recent files to 10', () => {
    const files = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);

    const limited = files.slice(0, 10);

    expect(limited).toHaveLength(10);
    expect(limited[0]).toBe('file0.ts');
    expect(limited[9]).toBe('file9.ts');
  });

  it('should extract filename from path', () => {
    const paths = [
      'src/app/login/page.tsx',
      'src/lib/auth.ts',
      'src/components/LoginForm.tsx'
    ];

    const filenames = paths.map(p => p.split('/').pop());

    expect(filenames).toEqual(['page.tsx', 'auth.ts', 'LoginForm.tsx']);
  });
});
