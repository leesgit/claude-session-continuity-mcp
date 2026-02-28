// 메모리 시스템 도구 (7개)
import { db } from '../db/database.js';
import { generateEmbedding, embeddingToBuffer } from '../utils/embedding.js';
import type { Tool, CallToolResult } from '../types.js';

// 태그 파싱 헬퍼 (JSON 배열 또는 콤마구분 문자열 모두 처리)
function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [String(parsed)];
  } catch {
    // 콤마구분 문자열 fallback (e.g. "auto-tracked,code,ts")
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
}

// ===== 도구 정의 =====

export const memoryTools: Tool[] = [
  {
    name: 'store_memory',
    description: '새로운 지식/학습/결정 사항을 메모리에 저장합니다. Claude가 배운 것들을 기억합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '저장할 내용' },
        memoryType: {
          type: 'string',
          enum: ['observation', 'decision', 'learning', 'error', 'pattern', 'preference'],
          description: '메모리 유형 (observation: 관찰, decision: 결정, learning: 학습, error: 에러, pattern: 패턴, preference: 선호)'
        },
        tags: { type: 'array', items: { type: 'string' }, description: '태그 목록 (검색용)' },
        project: { type: 'string', description: '관련 프로젝트 (선택)' },
        importance: { type: 'number', description: '중요도 1-10 (기본: 5)' },
        metadata: { type: 'object', description: '추가 메타데이터 (선택)' }
      },
      required: ['content', 'memoryType']
    }
  },
  {
    name: 'recall_memory',
    description: '키워드로 관련 메모리를 검색합니다. FTS5 전체 텍스트 검색을 사용합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색 쿼리 (자연어)' },
        memoryType: { type: 'string', description: '메모리 유형 필터 (선택)' },
        project: { type: 'string', description: '프로젝트 필터 (선택)' },
        limit: { type: 'number', description: '최대 결과 수 (기본: 10)' },
        minImportance: { type: 'number', description: '최소 중요도 (기본: 1)' },
        maxContentLength: { type: 'number', description: '각 메모리 내용 최대 길이 (기본: 500, 0이면 무제한)' }
      },
      required: ['query']
    }
  },
  {
    name: 'recall_by_timeframe',
    description: '특정 기간의 메모리를 조회합니다. (예: 오늘, 이번주, 지난달)',
    inputSchema: {
      type: 'object',
      properties: {
        timeframe: {
          type: 'string',
          enum: ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month'],
          description: '조회 기간'
        },
        memoryType: { type: 'string', description: '메모리 유형 필터 (선택)' },
        project: { type: 'string', description: '프로젝트 필터 (선택)' },
        limit: { type: 'number', description: '최대 결과 수 (기본: 20)' }
      },
      required: ['timeframe']
    }
  },
  {
    name: 'search_by_tag',
    description: '태그로 메모리를 검색합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' }, description: '검색할 태그들' },
        matchAll: { type: 'boolean', description: '모든 태그 일치 필요 여부 (기본: false)' },
        limit: { type: 'number', description: '최대 결과 수 (기본: 20)' }
      },
      required: ['tags']
    }
  },
  {
    name: 'get_memory_stats',
    description: '메모리 시스템 통계를 조회합니다.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'delete_memory',
    description: '메모리를 삭제합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        memoryId: { type: 'number', description: '삭제할 메모리 ID' }
      },
      required: ['memoryId']
    }
  }
];

// ===== 핸들러 =====

export async function storeMemory(
  content: string,
  memoryType: string,
  tags?: string[],
  project?: string,
  importance?: number,
  metadata?: Record<string, unknown>
): Promise<CallToolResult> {
  try {
    const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      content,
      memoryType,
      tags ? JSON.stringify(tags) : null,
      project || null,
      importance || 5,
      metadata ? JSON.stringify(metadata) : null
    );

    const memoryId = result.lastInsertRowid as number;

    // 임베딩 생성 (비동기)
    generateEmbedding(content).then(embedding => {
      if (embedding) {
        try {
          const embStmt = db.prepare(`
            INSERT OR REPLACE INTO embeddings (memory_id, embedding)
            VALUES (?, ?)
          `);
          embStmt.run(memoryId, embeddingToBuffer(embedding));
        } catch (e) {
          console.error('Embedding save error:', e);
        }
      }
    });

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          id: memoryId,
          embeddingQueued: true
        })
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function recallMemory(
  query: string,
  memoryType?: string,
  project?: string,
  limit: number = 10,
  minImportance: number = 1,
  maxContentLength: number = 500
): CallToolResult {
  try {
    // FTS5 쿼리 준비
    const ftsQuery = query.split(/\s+/).filter(w => w.length > 1).join(' OR ');

    let sql = `
      SELECT m.id, m.content, m.memory_type, m.tags, m.project, m.importance, m.created_at, m.access_count
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
      AND m.importance >= ?
    `;
    const params: unknown[] = [ftsQuery || query, minImportance];

    if (memoryType) {
      sql += ` AND m.memory_type = ?`;
      params.push(memoryType);
    }

    if (project) {
      sql += ` AND m.project = ?`;
      params.push(project);
    }

    sql += ` ORDER BY m.importance DESC, m.accessed_at DESC LIMIT ?`;
    params.push(limit);

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

    // 접근 카운트 업데이트
    const updateStmt = db.prepare(`
      UPDATE memories SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
      WHERE id = ?
    `);
    rows.forEach(row => updateStmt.run(row.id));

    const memories = rows.map(row => ({
      id: row.id,
      content: maxContentLength > 0 && row.content.length > maxContentLength
        ? row.content.slice(0, maxContentLength) + '...'
        : row.content,
      type: row.memory_type,
      tags: parseTags(row.tags),
      project: row.project,
      importance: row.importance,
      createdAt: row.created_at,
      accessCount: row.access_count
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          query,
          found: memories.length,
          memories
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function recallByTimeframe(
  timeframe: string,
  memoryType?: string,
  project?: string,
  limit: number = 20
): CallToolResult {
  try {
    const timeframeConditions: Record<string, string> = {
      today: "date(created_at) = date('now')",
      yesterday: "date(created_at) = date('now', '-1 day')",
      this_week: "created_at >= date('now', 'weekday 0', '-7 days')",
      last_week: "created_at >= date('now', 'weekday 0', '-14 days') AND created_at < date('now', 'weekday 0', '-7 days')",
      this_month: "strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')",
      last_month: "strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', '-1 month')"
    };

    let sql = `SELECT * FROM memories WHERE ${timeframeConditions[timeframe] || '1=1'}`;
    const params: unknown[] = [];

    if (memoryType) {
      sql += ` AND memory_type = ?`;
      params.push(memoryType);
    }

    if (project) {
      sql += ` AND project = ?`;
      params.push(project);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      content: string;
      memory_type: string;
      tags: string | null;
      project: string | null;
      importance: number;
      created_at: string;
    }>;

    const memories = rows.map(row => ({
      id: row.id,
      content: row.content,
      type: row.memory_type,
      tags: parseTags(row.tags),
      project: row.project,
      importance: row.importance,
      createdAt: row.created_at
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          timeframe,
          found: memories.length,
          memories
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function searchByTag(
  tags: string[],
  matchAll: boolean = false,
  limit: number = 20
): CallToolResult {
  try {
    let sql = `SELECT * FROM memories WHERE `;
    const conditions = tags.map(() => `tags LIKE ?`);
    sql += matchAll ? conditions.join(' AND ') : conditions.join(' OR ');
    sql += ` ORDER BY importance DESC, created_at DESC LIMIT ?`;

    const params = [...tags.map(t => `%${t}%`), limit];
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      content: string;
      memory_type: string;
      tags: string | null;
      project: string | null;
      importance: number;
      created_at: string;
    }>;

    const memories = rows.map(row => ({
      id: row.id,
      content: row.content,
      type: row.memory_type,
      tags: parseTags(row.tags),
      project: row.project,
      importance: row.importance,
      createdAt: row.created_at
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          searchTags: tags,
          matchAll,
          found: memories.length,
          memories
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function getMemoryStats(): CallToolResult {
  try {
    const totalMemories = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number }).count;
    const totalRelations = (db.prepare('SELECT COUNT(*) as count FROM memory_relations').get() as { count: number }).count;

    const byType = db.prepare(`
      SELECT memory_type as type, COUNT(*) as count
      FROM memories GROUP BY memory_type
    `).all() as Array<{ type: string; count: number }>;

    const byProject = db.prepare(`
      SELECT COALESCE(project, 'no_project') as project, COUNT(*) as count
      FROM memories GROUP BY project
    `).all() as Array<{ project: string; count: number }>;

    const recentMemories = db.prepare(`
      SELECT id, content, memory_type, created_at
      FROM memories ORDER BY created_at DESC LIMIT 5
    `).all() as Array<{ id: number; content: string; memory_type: string; created_at: string }>;

    const mostAccessedMemories = db.prepare(`
      SELECT id, content, memory_type, access_count
      FROM memories ORDER BY access_count DESC LIMIT 5
    `).all() as Array<{ id: number; content: string; memory_type: string; access_count: number }>;

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          totalMemories,
          totalRelations,
          byType: Object.fromEntries(byType.map(r => [r.type, r.count])),
          byProject: Object.fromEntries(byProject.map(r => [r.project, r.count])),
          recentMemories: recentMemories.map(m => ({
            id: m.id,
            content: m.content.substring(0, 100),
            type: m.memory_type,
            createdAt: m.created_at
          })),
          mostAccessedMemories: mostAccessedMemories.map(m => ({
            id: m.id,
            content: m.content.substring(0, 100),
            type: m.memory_type,
            accessCount: m.access_count
          }))
        }, null, 2)
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}

export function deleteMemory(memoryId: number): CallToolResult {
  try {
    // 임베딩도 CASCADE로 삭제됨
    const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
    const result = stmt.run(memoryId);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          deleted: result.changes > 0,
          memoryId
        })
      }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}` }],
      isError: true
    };
  }
}
