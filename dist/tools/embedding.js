// 임베딩 및 시맨틱 검색 도구 (3개)
import { db } from '../db/database.js';
import { generateEmbedding, cosineSimilarity, embeddingToBuffer, bufferToEmbedding, isEmbeddingReady, getEmbeddingPipeline } from '../utils/embedding.js';
// ===== 도구 정의 =====
export const embeddingTools = [
    {
        name: 'semantic_search',
        description: '시맨틱 검색으로 의미적으로 유사한 메모리를 찾습니다. AI 임베딩(all-MiniLM-L6-v2)을 사용합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색 쿼리 (자연어, 의미 기반 검색)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 10)' },
                minSimilarity: { type: 'number', description: '최소 유사도 0-1 (기본: 0.3)' },
                memoryType: { type: 'string', description: '메모리 유형 필터 (선택)' },
                project: { type: 'string', description: '프로젝트 필터 (선택)' }
            },
            required: ['query']
        }
    },
    {
        name: 'rebuild_embeddings',
        description: '모든 메모리의 임베딩을 다시 생성합니다. 모델 업데이트 후 사용합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                force: { type: 'boolean', description: '기존 임베딩도 다시 생성 (기본: false, 누락된 것만)' }
            }
        }
    },
    {
        name: 'get_embedding_status',
        description: '임베딩 시스템 상태를 확인합니다.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    }
];
// ===== 핸들러 =====
export async function semanticSearch(query, limit = 10, minSimilarity = 0.3, memoryType, project) {
    try {
        const queryEmbedding = await generateEmbedding(query);
        if (!queryEmbedding) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            error: 'Embedding model not ready',
                            fallback: 'Use recall_memory for FTS search'
                        })
                    }],
                isError: true
            };
        }
        // 모든 임베딩 가져오기
        let sql = `
      SELECT e.memory_id, e.embedding, m.content, m.memory_type, m.project, m.importance
      FROM embeddings e
      JOIN memories m ON m.id = e.memory_id
      WHERE 1=1
    `;
        const params = [];
        if (memoryType) {
            sql += ` AND m.memory_type = ?`;
            params.push(memoryType);
        }
        if (project) {
            sql += ` AND m.project = ?`;
            params.push(project);
        }
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        // 유사도 계산
        const results = rows.map(row => {
            const embedding = bufferToEmbedding(row.embedding);
            const similarity = cosineSimilarity(queryEmbedding, embedding);
            return {
                id: row.memory_id,
                content: row.content,
                type: row.memory_type,
                project: row.project,
                importance: row.importance,
                similarity: Math.round(similarity * 1000) / 1000
            };
        });
        // 유사도 필터링 및 정렬
        const filtered = results
            .filter(r => r.similarity >= minSimilarity)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        query,
                        found: filtered.length,
                        results: filtered
                    }, null, 2)
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
export async function rebuildEmbeddings(force = false) {
    try {
        if (!getEmbeddingPipeline()) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: 'Embedding model not ready yet' })
                    }],
                isError: true
            };
        }
        // 임베딩이 필요한 메모리 조회
        let sql = `SELECT id, content FROM memories`;
        if (!force) {
            sql += ` WHERE id NOT IN (SELECT memory_id FROM embeddings)`;
        }
        const stmt = db.prepare(sql);
        const rows = stmt.all();
        let processed = 0;
        let errors = 0;
        for (const row of rows) {
            try {
                const embedding = await generateEmbedding(row.content);
                if (embedding) {
                    const embStmt = db.prepare(`
            INSERT OR REPLACE INTO embeddings (memory_id, embedding)
            VALUES (?, ?)
          `);
                    embStmt.run(row.id, embeddingToBuffer(embedding));
                    processed++;
                }
            }
            catch {
                errors++;
            }
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        totalMemories: rows.length,
                        processed,
                        errors,
                        mode: force ? 'full rebuild' : 'missing only'
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
export function getEmbeddingStatus() {
    try {
        const totalMemories = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
        const totalEmbeddings = db.prepare('SELECT COUNT(*) as count FROM embeddings').get().count;
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        modelReady: isEmbeddingReady(),
                        model: 'all-MiniLM-L6-v2',
                        dimensions: 384,
                        totalMemories,
                        totalEmbeddings,
                        missingEmbeddings: totalMemories - totalEmbeddings,
                        coverage: totalMemories > 0 ? Math.round((totalEmbeddings / totalMemories) * 100) : 100
                    })
                }]
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
