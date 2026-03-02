// 메모리 도구 (memory_store, memory_search, memory_delete, memory_stats)
// 통합 메모리 관리 - FTS + 시맨틱 검색
import { db } from '../db/database.js';
import { generateEmbedding, embeddingToBuffer, bufferToEmbedding, cosineSimilarity } from '../utils/embedding.js';
import { logger } from '../utils/logger.js';
import { MemoryStoreSchema, MemorySearchSchema, MemoryGetSchema, MemoryDeleteSchema } from '../schemas.js';
import type { Tool, CallToolResult } from '../types.js';

// ===== Temporal Decay =====

const DECAY_RATES: Record<string, number> = {
  decision: 0.001,    // 반감기 ~693일
  learning: 0.003,    // 반감기 ~231일
  error: 0.01,        // 반감기 ~69일
  pattern: 0.005,     // 반감기 ~139일
  observation: 0.05,  // 반감기 ~14일
  preference: 0.002,  // 반감기 ~347일
};

export function calculateDecayedScore(
  importance: number,
  memoryType: string,
  createdAt: string,
  accessCount: number
): number {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  const decayRate = DECAY_RATES[memoryType] ?? 0.005;
  return importance * Math.exp(-decayRate * ageDays) * Math.log2(accessCount + 2);
}

// ===== Jaccard 유사도 (Memory Consolidation) =====

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

// 태그 파싱 헬퍼 (JSON 배열 또는 콤마구분 문자열 모두 처리)
function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
}

// ===== 도구 정의 =====

export const memoryTools: Tool[] = [
  {
    name: 'memory_store',
    description: `메모리 저장. 학습/결정/에러/패턴을 기억합니다.
- content: 저장할 내용 (필수)
- type: observation|decision|learning|error|pattern|preference
- tags: 검색용 태그 배열
- project: 관련 프로젝트
- importance: 중요도 1-10 (기본 5)
임베딩 자동 생성으로 시맨틱 검색 지원.`,
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '저장할 내용' },
        type: {
          type: 'string',
          enum: ['observation', 'decision', 'learning', 'error', 'pattern', 'preference'],
          description: '메모리 유형'
        },
        tags: { type: 'array', items: { type: 'string' }, description: '태그 목록' },
        project: { type: 'string', description: '관련 프로젝트' },
        importance: { type: 'number', description: '중요도 1-10' },
        metadata: { type: 'object', description: '추가 메타데이터' }
      },
      required: ['content', 'type']
    }
  },
  {
    name: 'memory_search',
    description: `메모리 검색. FTS 또는 시맨틱 검색 지원.
- query: 검색 쿼리 (필수)
- type: 메모리 유형 필터
- project: 프로젝트 필터
- semantic: true면 시맨틱 검색 (의미 기반)
- limit: 최대 결과 수 (기본 10)
- minImportance: 최소 중요도 (기본 1)`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색 쿼리' },
        type: { type: 'string', description: '메모리 유형 필터' },
        project: { type: 'string', description: '프로젝트 필터' },
        semantic: { type: 'boolean', description: '시맨틱 검색 사용' },
        limit: { type: 'number', description: '최대 결과 수' },
        minImportance: { type: 'number', description: '최소 중요도' }
      },
      required: ['query']
    }
  },
  {
    name: 'memory_get',
    description: `메모리 ID로 전체 내용 조회. memory_search 결과에서 상세 내용을 확인할 때 사용.
- ids: 조회할 메모리 ID 배열 (최대 20개)
- access_count 자동 증가`,
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'number' }, description: '메모리 ID 목록' }
      },
      required: ['ids']
    }
  },
  {
    name: 'memory_delete',
    description: '메모리 삭제. 관련 임베딩도 함께 삭제됩니다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: '삭제할 메모리 ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'memory_stats',
    description: `메모리 시스템 통계 조회.
- 총 메모리/관계 수
- 유형별/프로젝트별 분포
- 최근 메모리 5개
- 가장 많이 접근한 메모리 5개
- 임베딩 커버리지`,
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// ===== 핸들러 =====

export async function handleMemoryStore(args: unknown): Promise<CallToolResult> {
  return logger.withTool('memory_store', async () => {
    // 입력 검증
    const parsed = MemoryStoreSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }],
        isError: true
      };
    }

    const { content, type, tags, project, importance, metadata } = parsed.data;

    // Memory Consolidation: 기존 유사 메모리와 병합 시도
    let memoryId: number;
    let consolidated = false;

    try {
      const existing = db.prepare(`
        SELECT id, content, importance, access_count FROM memories
        WHERE project = ? AND memory_type = ?
        ORDER BY importance DESC, created_at DESC LIMIT 20
      `).all(project || null, type) as Array<{
        id: number; content: string; importance: number; access_count: number;
      }>;

      let mergeTarget: typeof existing[0] | null = null;
      for (const row of existing) {
        if (jaccardSimilarity(content, row.content) >= 0.6) {
          mergeTarget = row;
          break;
        }
      }

      if (mergeTarget) {
        // 더 긴 content 채택, importance +1, access_count +1
        const betterContent = content.length >= mergeTarget.content.length ? content : mergeTarget.content;
        const newImportance = Math.min(10, mergeTarget.importance + 1);
        db.prepare(`
          UPDATE memories SET content = ?, importance = ?, access_count = access_count + 1,
            accessed_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(betterContent, newImportance, mergeTarget.id);
        memoryId = mergeTarget.id;
        consolidated = true;
      } else {
        const result = db.prepare(`
          INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(content, type, tags ? JSON.stringify(tags) : null, project || null, importance, metadata ? JSON.stringify(metadata) : null);
        memoryId = result.lastInsertRowid as number;
      }
    } catch {
      // Consolidation 실패 시 기존 방식 폴백
      const result = db.prepare(`
        INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(content, type, tags ? JSON.stringify(tags) : null, project || null, importance, metadata ? JSON.stringify(metadata) : null);
      memoryId = result.lastInsertRowid as number;
    }

    // 임베딩 생성 (새 메모리만, 비동기)
    if (!consolidated) {
      generateEmbedding(content).then(embedding => {
        if (embedding) {
          try {
            db.prepare(`INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)`).run(memoryId, embeddingToBuffer(embedding));
          } catch { /* ignore */ }
        }
      }).catch(() => { /* ignore */ });
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          id: memoryId,
          type,
          importance,
          consolidated,
          embeddingQueued: !consolidated
        })
      }]
    };
  }, args as Record<string, unknown>);
}

export async function handleMemorySearch(args: unknown): Promise<CallToolResult> {
  return logger.withTool('memory_search', async () => {
    // 입력 검증
    const parsed = MemorySearchSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }],
        isError: true
      };
    }

    const { query, type, project, semantic, limit, minImportance, detail } = parsed.data;

    // 시맨틱 검색
    if (semantic) {
      return performSemanticSearch(query, type, project, limit, minImportance, detail);
    }

    // FTS 검색
    return performFTSSearch(query, type, project, limit, minImportance, detail);
  }, args as Record<string, unknown>);
}

async function performFTSSearch(
  query: string,
  type?: string,
  project?: string,
  limit: number = 10,
  minImportance: number = 1,
  detail: boolean = false
): Promise<CallToolResult> {
  const ftsQuery = query.split(/\s+/).filter(w => w.length > 1).join(' OR ');

  let sql = `
    SELECT m.id, m.content, m.memory_type, m.tags, m.project, m.importance, m.created_at, m.access_count
    FROM memories_fts fts
    JOIN memories m ON m.id = fts.rowid
    WHERE memories_fts MATCH ?
    AND m.importance >= ?
  `;
  const params: unknown[] = [ftsQuery || query, minImportance];

  if (type) {
    sql += ` AND m.memory_type = ?`;
    params.push(type);
  }

  if (project) {
    sql += ` AND m.project = ?`;
    params.push(project);
  }

  // Fetch more rows for decay re-ranking
  sql += ` ORDER BY m.importance DESC, m.accessed_at DESC LIMIT ?`;
  params.push(limit * 3);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{
    id: number;
    content: string;
    memory_type: string;
    tags: string | null;
    project: string | null;
    importance: number;
    created_at: string;
    access_count: number;
  }>;

  // Decay 적용 후 re-rank
  const scored = rows.map(row => ({
    ...row,
    decayedScore: calculateDecayedScore(row.importance, row.memory_type, row.created_at, row.access_count)
  })).sort((a, b) => b.decayedScore - a.decayedScore).slice(0, limit);

  // 접근 카운트 업데이트
  const updateStmt = db.prepare(`
    UPDATE memories SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
    WHERE id = ?
  `);
  scored.forEach(row => updateStmt.run(row.id));

  const memories = scored.map(row => {
    if (detail) {
      return {
        id: row.id,
        content: row.content.length > 300 ? row.content.slice(0, 300) + '...' : row.content,
        type: row.memory_type,
        tags: parseTags(row.tags),
        project: row.project,
        importance: row.importance,
        createdAt: row.created_at
      };
    }
    // Progressive disclosure: index-only mode (~50 tokens per result)
    return {
      id: row.id,
      summary: row.content.slice(0, 80) + (row.content.length > 80 ? '...' : ''),
      type: row.memory_type,
      tags: parseTags(row.tags),
      importance: row.importance,
      createdAt: row.created_at
    };
  });

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        query,
        searchType: 'fts',
        found: memories.length,
        hint: detail ? undefined : 'Use memory_get({ ids: [...] }) to fetch full content',
        memories
      }, null, 2)
    }]
  };
}

async function performSemanticSearch(
  query: string,
  type?: string,
  project?: string,
  limit: number = 10,
  minImportance: number = 1,
  detail: boolean = false
): Promise<CallToolResult> {
  // 쿼리 임베딩 생성
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    return {
      content: [{ type: 'text' as const, text: 'Failed to generate query embedding' }],
      isError: true
    };
  }

  // 필터 조건 구성
  let sql = `
    SELECT m.id, m.content, m.memory_type, m.tags, m.project, m.importance, m.created_at,
           e.embedding
    FROM memories m
    JOIN embeddings e ON m.id = e.memory_id
    WHERE m.importance >= ?
  `;
  const params: unknown[] = [minImportance];

  if (type) {
    sql += ` AND m.memory_type = ?`;
    params.push(type);
  }

  if (project) {
    sql += ` AND m.project = ?`;
    params.push(project);
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{
    id: number;
    content: string;
    memory_type: string;
    tags: string | null;
    project: string | null;
    importance: number;
    created_at: string;
    embedding: Buffer;
  }>;

  // 유사도 계산 및 정렬
  const scored = rows.map(row => ({
    ...row,
    similarity: cosineSimilarity(queryEmbedding, bufferToEmbedding(row.embedding))
  }))
    .filter(r => r.similarity > 0.3) // 최소 유사도
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  // 접근 카운트 업데이트
  const updateStmt = db.prepare(`
    UPDATE memories SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
    WHERE id = ?
  `);
  scored.forEach(row => updateStmt.run(row.id));

  const memories = scored.map(row => {
    if (detail) {
      return {
        id: row.id,
        content: row.content.length > 300 ? row.content.slice(0, 300) + '...' : row.content,
        type: row.memory_type,
        tags: parseTags(row.tags),
        project: row.project,
        importance: row.importance,
        similarity: Math.round(row.similarity * 100) / 100,
        createdAt: row.created_at
      };
    }
    return {
      id: row.id,
      summary: row.content.slice(0, 80) + (row.content.length > 80 ? '...' : ''),
      type: row.memory_type,
      importance: row.importance,
      similarity: Math.round(row.similarity * 100) / 100,
      createdAt: row.created_at
    };
  });

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        query,
        searchType: 'semantic',
        found: memories.length,
        hint: detail ? undefined : 'Use memory_get({ ids: [...] }) to fetch full content',
        memories
      }, null, 2)
    }]
  };
}

export async function handleMemoryGet(args: unknown): Promise<CallToolResult> {
  return logger.withTool('memory_get', async () => {
    const parsed = MemoryGetSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }],
        isError: true
      };
    }

    const { ids } = parsed.data;
    const placeholders = ids.map(() => '?').join(',');

    const rows = db.prepare(`
      SELECT id, content, memory_type, tags, project, importance, created_at, access_count, metadata
      FROM memories WHERE id IN (${placeholders})
    `).all(...ids) as Array<{
      id: number; content: string; memory_type: string; tags: string | null;
      project: string | null; importance: number; created_at: string;
      access_count: number; metadata: string | null;
    }>;

    // access_count 증가
    const updateStmt = db.prepare(`
      UPDATE memories SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
      WHERE id = ?
    `);
    rows.forEach(row => updateStmt.run(row.id));

    const memories = rows.map(row => ({
      id: row.id,
      content: row.content,
      type: row.memory_type,
      tags: parseTags(row.tags),
      project: row.project,
      importance: row.importance,
      accessCount: row.access_count + 1,
      createdAt: row.created_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ found: memories.length, memories }, null, 2)
      }]
    };
  }, args as Record<string, unknown>);
}

export async function handleMemoryDelete(args: unknown): Promise<CallToolResult> {
  return logger.withTool('memory_delete', async () => {
    // 입력 검증
    const parsed = MemoryDeleteSchema.safeParse(args);
    if (!parsed.success) {
      return {
        content: [{ type: 'text' as const, text: `Validation error: ${parsed.error.message}` }],
        isError: true
      };
    }

    const { id } = parsed.data;

    const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(id);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          deleted: result.changes > 0,
          memoryId: id
        })
      }]
    };
  }, args as Record<string, unknown>);
}

export async function handleMemoryStats(): Promise<CallToolResult> {
  return logger.withTool('memory_stats', async () => {
    const totalMemories = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;
    const totalRelations = (db.prepare('SELECT COUNT(*) as count FROM memory_relations').get() as { count: number }).count;
    const totalEmbeddings = (db.prepare('SELECT COUNT(*) as count FROM embeddings').get() as { count: number }).count;

    const byType = db.prepare(`
      SELECT memory_type as type, COUNT(*) as count
      FROM memories GROUP BY memory_type
    `).all() as Array<{ type: string; count: number }>;

    const byProject = db.prepare(`
      SELECT COALESCE(project, 'no_project') as project, COUNT(*) as count
      FROM memories GROUP BY project
      ORDER BY count DESC LIMIT 10
    `).all() as Array<{ project: string; count: number }>;

    const recentMemories = db.prepare(`
      SELECT id, content, memory_type, created_at
      FROM memories ORDER BY created_at DESC LIMIT 5
    `).all() as Array<{ id: number; content: string; memory_type: string; created_at: string }>;

    const mostAccessed = db.prepare(`
      SELECT id, content, memory_type, access_count
      FROM memories WHERE access_count > 0
      ORDER BY access_count DESC LIMIT 5
    `).all() as Array<{ id: number; content: string; memory_type: string; access_count: number }>;

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          summary: {
            totalMemories,
            totalRelations,
            totalEmbeddings,
            embeddingCoverage: totalMemories > 0
              ? `${Math.round((totalEmbeddings / totalMemories) * 100)}%`
              : '0%'
          },
          byType: Object.fromEntries(byType.map(r => [r.type, r.count])),
          byProject: Object.fromEntries(byProject.map(r => [r.project, r.count])),
          recentMemories: recentMemories.map(m => ({
            id: m.id,
            preview: m.content.substring(0, 80) + (m.content.length > 80 ? '...' : ''),
            type: m.memory_type,
            createdAt: m.created_at
          })),
          mostAccessed: mostAccessed.map(m => ({
            id: m.id,
            preview: m.content.substring(0, 80) + (m.content.length > 80 ? '...' : ''),
            type: m.memory_type,
            accessCount: m.access_count
          }))
        }, null, 2)
      }]
    };
  });
}
