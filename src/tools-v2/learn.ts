// 학습 도구 (learn, recall_solution)
// 자동 학습 및 해결책 검색
import { db } from '../db/database.js';
import { generateEmbedding, embeddingToBuffer } from '../utils/embedding.js';
import { logger } from '../utils/logger.js';
import { LearnSchema, RecallSolutionSchema } from '../schemas.js';
import type { Tool, CallToolResult } from '../types.js';

// ===== 도구 정의 =====

export const learnTools: Tool[] = [
  {
    name: 'learn',
    description: `자동 학습 (결정/수정/패턴/의존성).
type에 따라 다른 정보 저장:
- decision: 기술 결정 (alternatives 포함)
- fix: 버그 수정 (solution, preventionTip)
- pattern: 코드 패턴 (example, appliesTo)
- dependency: 의존성 변경 (dependency, action, versions)

공통 필드: content, reason, files`,
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '프로젝트명' },
        type: {
          type: 'string',
          enum: ['decision', 'fix', 'pattern', 'dependency'],
          description: '학습 유형'
        },
        content: { type: 'string', description: '학습 내용' },
        reason: { type: 'string', description: '이유/원인' },
        files: { type: 'array', items: { type: 'string' }, description: '관련 파일' },
        // decision
        alternatives: { type: 'array', items: { type: 'string' }, description: '고려한 대안' },
        // fix
        solution: { type: 'string', description: '해결 방법' },
        preventionTip: { type: 'string', description: '재발 방지 팁' },
        // pattern
        example: { type: 'string', description: '예시 코드' },
        appliesTo: { type: 'string', description: '적용 대상' },
        // dependency
        dependency: { type: 'string', description: '의존성 이름' },
        action: { type: 'string', enum: ['add', 'remove', 'upgrade', 'downgrade'] },
        fromVersion: { type: 'string' },
        toVersion: { type: 'string' }
      },
      required: ['project', 'type', 'content']
    }
  },
  {
    name: 'recall_solution',
    description: `유사 이슈 해결 방법 검색.
에러 메시지나 이슈 설명으로 과거 해결 사례 검색.
FTS + 시맨틱 검색으로 유사 이슈 찾기.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '에러 메시지 또는 이슈 설명' },
        project: { type: 'string', description: '프로젝트 필터 (선택)' }
      },
      required: ['query']
    }
  }
];

// ===== 핸들러 =====

export async function handleLearn(args: unknown): Promise<CallToolResult> {
  return logger.withTool('learn', async () => {
    // 입력 검증
    const parsed = LearnSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }],
        isError: true
      };
    }

    const data = parsed.data;

    // 메모리 타입 매핑
    const memoryTypeMap: Record<string, string> = {
      decision: 'decision',
      fix: 'error',
      pattern: 'pattern',
      dependency: 'learning'
    };

    // 메타데이터 구성
    const metadata: Record<string, unknown> = {
      learnType: data.type,
      reason: data.reason,
      files: data.files
    };

    // 타입별 추가 정보
    switch (data.type) {
      case 'decision':
        metadata.alternatives = data.alternatives;
        break;
      case 'fix':
        metadata.solution = data.solution;
        metadata.preventionTip = data.preventionTip;
        // solutions에도 저장
        saveResolvedIssue(data);
        break;
      case 'pattern':
        metadata.example = data.example;
        metadata.appliesTo = data.appliesTo;
        break;
      case 'dependency':
        metadata.dependency = data.dependency;
        metadata.action = data.action;
        metadata.fromVersion = data.fromVersion;
        metadata.toVersion = data.toVersion;
        break;
    }

    // 메모리 저장
    const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const tags = [data.type, ...data.files?.slice(0, 3) || []];
    const result = stmt.run(
      data.content,
      memoryTypeMap[data.type],
      JSON.stringify(tags),
      data.project,
      data.type === 'decision' ? 8 : data.type === 'fix' ? 7 : 6,
      JSON.stringify(metadata)
    );

    const memoryId = result.lastInsertRowid as number;

    // 임베딩 생성 (비동기)
    generateEmbedding(data.content + ' ' + (data.reason || '')).then(embedding => {
      if (embedding) {
        try {
          const embStmt = db.prepare(`INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)`);
          embStmt.run(memoryId, embeddingToBuffer(embedding));
        } catch { /* ignore */ }
      }
    }).catch(() => { /* ignore */ });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          type: data.type,
          memoryId,
          project: data.project,
          content: data.content.substring(0, 100) + (data.content.length > 100 ? '...' : '')
        })
      }]
    };
  }, args as Record<string, unknown>);
}

function saveResolvedIssue(data: {
  project: string;
  content: string;
  solution?: string;
  files?: string[];
}): void {
  try {
    // 에러 시그니처 추출 (간단한 해시)
    const signature = data.content
      .replace(/\d+/g, 'N') // 숫자 일반화
      .replace(/0x[a-f0-9]+/gi, 'ADDR') // 메모리 주소 일반화
      .substring(0, 200);

    const stmt = db.prepare(`
      INSERT INTO solutions (project, error_signature, error_message, solution, related_files, keywords)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const keywords = data.content
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 10)
      .join(' ');

    stmt.run(
      data.project,
      signature,
      data.content.substring(0, 1000),
      data.solution || '',
      JSON.stringify(data.files || []),
      keywords
    );
  } catch (e) {
    logger.error('Failed to save resolved issue', { error: String(e) }, 'learn');
  }
}

export async function handleRecallSolution(args: unknown): Promise<CallToolResult> {
  return logger.withTool('recall_solution', async () => {
    // 입력 검증
    const parsed = RecallSolutionSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }],
        isError: true
      };
    }

    const { query, project } = parsed.data;

    // 1. solutions에서 검색
    let issuesSql = `
      SELECT id, project, error_message, solution, related_files, created_at
      FROM solutions
      WHERE error_message LIKE ? OR keywords LIKE ?
    `;
    const params: unknown[] = [`%${query.substring(0, 50)}%`, `%${query.split(' ')[0]}%`];

    if (project) {
      issuesSql += ` AND project = ?`;
      params.push(project);
    }

    issuesSql += ` ORDER BY created_at DESC LIMIT 5`;

    const issuesStmt = db.prepare(issuesSql);
    const issues = issuesStmt.all(...params) as Array<{
      id: number;
      project: string;
      error_message: string;
      solution: string;
      related_files: string;
      created_at: string;
    }>;

    // 2. error 타입 메모리에서 검색
    let memoriesSql = `
      SELECT m.id, m.content, m.metadata, m.created_at
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ? AND m.memory_type = 'error'
    `;
    const ftsQuery = query.split(/\s+/).filter(w => w.length > 2).slice(0, 5).join(' OR ');

    const memoriesStmt = db.prepare(memoriesSql + ` LIMIT 5`);
    const memories = memoriesStmt.all(ftsQuery || query) as Array<{
      id: number;
      content: string;
      metadata: string | null;
      created_at: string;
    }>;

    const solutions = [
      ...issues.map(i => ({
        source: 'solutions',
        id: i.id,
        project: i.project,
        error: i.error_message.substring(0, 200),
        solution: i.solution,
        files: i.related_files ? JSON.parse(i.related_files) : [],
        date: i.created_at
      })),
      ...memories.map(m => {
        const meta = m.metadata ? JSON.parse(m.metadata) : {};
        return {
          source: 'memory',
          id: m.id,
          error: m.content.substring(0, 200),
          solution: meta.solution || '(메타데이터에서 solution 확인)',
          preventionTip: meta.preventionTip,
          files: meta.files || [],
          date: m.created_at
        };
      })
    ];

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          query: query.substring(0, 100),
          found: solutions.length,
          solutions
        }, null, 2)
      }]
    };
  }, args as Record<string, unknown>);
}
