// 메모리 도구 (memory_store, memory_search, memory_delete, memory_stats)
// 통합 메모리 관리 - FTS + 시맨틱 검색
import { db } from '../db/database.js';
import { generateEmbedding, embeddingToBuffer, bufferToEmbedding, cosineSimilarity } from '../utils/embedding.js';
import { logger } from '../utils/logger.js';
import { MemoryStoreSchema, MemorySearchSchema, MemoryDeleteSchema } from '../schemas.js';
// ===== 도구 정의 =====
export const memoryTools = [
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
export async function handleMemoryStore(args) {
    return logger.withTool('memory_store', async () => {
        // 입력 검증
        const parsed = MemoryStoreSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { content, type, tags, project, importance, metadata } = parsed.data;
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(content, type, tags ? JSON.stringify(tags) : null, project || null, importance, metadata ? JSON.stringify(metadata) : null);
        const memoryId = result.lastInsertRowid;
        // 임베딩 생성 (비동기, 에러 무시)
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                try {
                    const embStmt = db.prepare(`
            INSERT OR REPLACE INTO embeddings (memory_id, embedding)
            VALUES (?, ?)
          `);
                    embStmt.run(memoryId, embeddingToBuffer(embedding));
                    logger.debug('Embedding created', { memoryId }, 'memory_store');
                }
                catch (e) {
                    logger.error('Embedding save failed', { memoryId, error: String(e) }, 'memory_store');
                }
            }
        }).catch(() => { });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        id: memoryId,
                        type,
                        importance,
                        embeddingQueued: true
                    })
                }]
        };
    }, args);
}
export async function handleMemorySearch(args) {
    return logger.withTool('memory_search', async () => {
        // 입력 검증
        const parsed = MemorySearchSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { query, type, project, semantic, limit, minImportance } = parsed.data;
        // 시맨틱 검색
        if (semantic) {
            return performSemanticSearch(query, type, project, limit, minImportance);
        }
        // FTS 검색
        return performFTSSearch(query, type, project, limit, minImportance);
    }, args);
}
async function performFTSSearch(query, type, project, limit = 10, minImportance = 1) {
    const ftsQuery = query.split(/\s+/).filter(w => w.length > 1).join(' OR ');
    let sql = `
    SELECT m.id, m.content, m.memory_type, m.tags, m.project, m.importance, m.created_at, m.access_count
    FROM memories_fts fts
    JOIN memories m ON m.id = fts.rowid
    WHERE memories_fts MATCH ?
    AND m.importance >= ?
  `;
    const params = [ftsQuery || query, minImportance];
    if (type) {
        sql += ` AND m.memory_type = ?`;
        params.push(type);
    }
    if (project) {
        sql += ` AND m.project = ?`;
        params.push(project);
    }
    sql += ` ORDER BY m.importance DESC, m.accessed_at DESC LIMIT ?`;
    params.push(limit);
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    // 접근 카운트 업데이트
    const updateStmt = db.prepare(`
    UPDATE memories SET accessed_at = CURRENT_TIMESTAMP, access_count = access_count + 1
    WHERE id = ?
  `);
    rows.forEach(row => updateStmt.run(row.id));
    const memories = rows.map(row => ({
        id: row.id,
        content: row.content.length > 300 ? row.content.slice(0, 300) + '...' : row.content,
        type: row.memory_type,
        tags: row.tags ? JSON.parse(row.tags) : [],
        project: row.project,
        importance: row.importance,
        createdAt: row.created_at
    }));
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({
                    query,
                    searchType: 'fts',
                    found: memories.length,
                    memories
                }, null, 2)
            }]
    };
}
async function performSemanticSearch(query, type, project, limit = 10, minImportance = 1) {
    // 쿼리 임베딩 생성
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
        return {
            content: [{ type: 'text', text: 'Failed to generate query embedding' }],
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
    const params = [minImportance];
    if (type) {
        sql += ` AND m.memory_type = ?`;
        params.push(type);
    }
    if (project) {
        sql += ` AND m.project = ?`;
        params.push(project);
    }
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
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
    const memories = scored.map(row => ({
        id: row.id,
        content: row.content.length > 300 ? row.content.slice(0, 300) + '...' : row.content,
        type: row.memory_type,
        tags: row.tags ? JSON.parse(row.tags) : [],
        project: row.project,
        importance: row.importance,
        similarity: Math.round(row.similarity * 100) / 100,
        createdAt: row.created_at
    }));
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({
                    query,
                    searchType: 'semantic',
                    found: memories.length,
                    memories
                }, null, 2)
            }]
    };
}
export async function handleMemoryDelete(args) {
    return logger.withTool('memory_delete', async () => {
        // 입력 검증
        const parsed = MemoryDeleteSchema.safeParse(args);
        if (!parsed.success) {
            return {
                content: [{ type: 'text', text: `Validation error: ${parsed.error.message}` }],
                isError: true
            };
        }
        const { id } = parsed.data;
        const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
        const result = stmt.run(id);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        deleted: result.changes > 0,
                        memoryId: id
                    })
                }]
        };
    }, args);
}
export async function handleMemoryStats() {
    return logger.withTool('memory_stats', async () => {
        const totalMemories = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
        const totalRelations = db.prepare('SELECT COUNT(*) as count FROM memory_relations').get().count;
        const totalEmbeddings = db.prepare('SELECT COUNT(*) as count FROM embeddings').get().count;
        const byType = db.prepare(`
      SELECT memory_type as type, COUNT(*) as count
      FROM memories GROUP BY memory_type
    `).all();
        const byProject = db.prepare(`
      SELECT COALESCE(project, 'no_project') as project, COUNT(*) as count
      FROM memories GROUP BY project
      ORDER BY count DESC LIMIT 10
    `).all();
        const recentMemories = db.prepare(`
      SELECT id, content, memory_type, created_at
      FROM memories ORDER BY created_at DESC LIMIT 5
    `).all();
        const mostAccessed = db.prepare(`
      SELECT id, content, memory_type, access_count
      FROM memories WHERE access_count > 0
      ORDER BY access_count DESC LIMIT 5
    `).all();
        return {
            content: [{
                    type: 'text',
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
