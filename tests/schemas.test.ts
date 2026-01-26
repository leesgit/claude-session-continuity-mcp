// 스키마 유효성 테스트
import { describe, it, expect } from 'vitest';
import {
  ContextGetSchema,
  ContextUpdateSchema,
  MemoryStoreSchema,
  MemorySearchSchema,
  MemoryDeleteSchema,
  TaskManageSchema,
  VerifySchema,
  LearnSchema,
  RecallSolutionSchema,
  ProjectsSchema
} from '../src/schemas.js';

describe('ContextGetSchema', () => {
  it('should validate valid input', () => {
    const result = ContextGetSchema.safeParse({ project: 'test-project' });
    expect(result.success).toBe(true);
  });

  it('should reject missing project', () => {
    const result = ContextGetSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject empty project', () => {
    const result = ContextGetSchema.safeParse({ project: '' });
    expect(result.success).toBe(false);
  });
});

describe('ContextUpdateSchema', () => {
  it('should validate minimal input', () => {
    const result = ContextUpdateSchema.safeParse({
      project: 'test',
      currentState: 'Working on feature X'
    });
    expect(result.success).toBe(true);
  });

  it('should validate full input', () => {
    const result = ContextUpdateSchema.safeParse({
      project: 'test',
      currentState: 'Working on feature X',
      recentFiles: ['src/index.ts', 'src/utils.ts'],
      blockers: 'API rate limit',
      verification: 'passed',
      architectureDecision: 'Use WebSocket instead of polling'
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid verification value', () => {
    const result = ContextUpdateSchema.safeParse({
      project: 'test',
      currentState: 'Working',
      verification: 'unknown'
    });
    expect(result.success).toBe(false);
  });
});

describe('MemoryStoreSchema', () => {
  it('should validate valid memory', () => {
    const result = MemoryStoreSchema.safeParse({
      content: 'Learned that useEffect needs cleanup',
      type: 'learning'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.importance).toBe(5); // default value
    }
  });

  it('should validate with all fields', () => {
    const result = MemoryStoreSchema.safeParse({
      content: 'Always use TypeScript strict mode',
      type: 'pattern',
      project: 'my-app',
      tags: ['typescript', 'best-practice'],
      importance: 8,
      metadata: { source: 'code-review' }
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid type', () => {
    const result = MemoryStoreSchema.safeParse({
      content: 'test',
      type: 'invalid-type'
    });
    expect(result.success).toBe(false);
  });

  it('should reject importance out of range', () => {
    const result = MemoryStoreSchema.safeParse({
      content: 'test',
      type: 'observation',
      importance: 15
    });
    expect(result.success).toBe(false);
  });
});

describe('MemorySearchSchema', () => {
  it('should validate minimal search', () => {
    const result = MemorySearchSchema.safeParse({
      query: 'typescript error'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.semantic).toBe(false);
    }
  });

  it('should validate semantic search', () => {
    const result = MemorySearchSchema.safeParse({
      query: 'how to handle async errors',
      semantic: true,
      limit: 5
    });
    expect(result.success).toBe(true);
  });
});

describe('TaskManageSchema', () => {
  it('should validate add action', () => {
    const result = TaskManageSchema.safeParse({
      action: 'add',
      project: 'test',
      title: 'Implement login',
      description: 'Add OAuth login',
      priority: 8
    });
    expect(result.success).toBe(true);
  });

  it('should validate complete action', () => {
    const result = TaskManageSchema.safeParse({
      action: 'complete',
      project: 'test',
      taskId: 1
    });
    expect(result.success).toBe(true);
  });

  it('should validate update action', () => {
    const result = TaskManageSchema.safeParse({
      action: 'update',
      project: 'test',
      taskId: 1,
      status: 'in_progress'
    });
    expect(result.success).toBe(true);
  });

  it('should validate list action', () => {
    const result = TaskManageSchema.safeParse({
      action: 'list',
      project: 'test'
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid status', () => {
    const result = TaskManageSchema.safeParse({
      action: 'update',
      project: 'test',
      taskId: 1,
      status: 'invalid'
    });
    expect(result.success).toBe(false);
  });
});

describe('VerifySchema', () => {
  it('should validate with default gates', () => {
    const result = VerifySchema.safeParse({
      project: 'test'
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gates).toEqual(['build', 'test', 'lint']);
    }
  });

  it('should validate with custom gates', () => {
    const result = VerifySchema.safeParse({
      project: 'test',
      gates: ['build', 'lint']
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid gate', () => {
    const result = VerifySchema.safeParse({
      project: 'test',
      gates: ['build', 'deploy']
    });
    expect(result.success).toBe(false);
  });
});

describe('LearnSchema', () => {
  it('should validate decision learning', () => {
    const result = LearnSchema.safeParse({
      project: 'test',
      type: 'decision',
      content: 'Use React Query for API calls',
      reason: 'Better caching and loading states',
      alternatives: ['SWR', 'RTK Query']
    });
    expect(result.success).toBe(true);
  });

  it('should validate fix learning', () => {
    const result = LearnSchema.safeParse({
      project: 'test',
      type: 'fix',
      content: 'TypeError: Cannot read property of undefined',
      solution: 'Add null check before accessing property',
      preventionTip: 'Use optional chaining'
    });
    expect(result.success).toBe(true);
  });

  it('should validate pattern learning', () => {
    const result = LearnSchema.safeParse({
      project: 'test',
      type: 'pattern',
      content: 'Custom hook for form validation',
      example: 'const { errors, validate } = useFormValidation(schema)',
      appliesTo: 'All form components'
    });
    expect(result.success).toBe(true);
  });

  it('should validate dependency learning', () => {
    const result = LearnSchema.safeParse({
      project: 'test',
      type: 'dependency',
      content: 'Upgraded React to v18',
      dependency: 'react',
      action: 'upgrade',
      fromVersion: '17.0.2',
      toVersion: '18.2.0'
    });
    expect(result.success).toBe(true);
  });
});

describe('RecallSolutionSchema', () => {
  it('should validate query', () => {
    const result = RecallSolutionSchema.safeParse({
      query: 'TypeError: Cannot read property'
    });
    expect(result.success).toBe(true);
  });

  it('should validate with project filter', () => {
    const result = RecallSolutionSchema.safeParse({
      query: 'Build failed',
      project: 'my-app'
    });
    expect(result.success).toBe(true);
  });
});

describe('ProjectsSchema', () => {
  it('should validate empty input (list all)', () => {
    const result = ProjectsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should validate with specific project', () => {
    const result = ProjectsSchema.safeParse({
      project: 'my-app'
    });
    expect(result.success).toBe(true);
  });
});
