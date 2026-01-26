// 임베딩 도구 (rebuild_embeddings)
// 시맨틱 검색용 임베딩 관리
import { db } from '../db/database.js';
import { generateEmbedding, embeddingToBuffer } from '../utils/embedding.js';
import { logger } from '../utils/logger.js';
// ===== 도구 정의 =====
export const embeddingTools = [
    {
        name: 'rebuild_embeddings',
        description: `임베딩 재생성.
- force=false: 누락된 임베딩만 생성
- force=true: 전체 임베딩 재생성

시맨틱 검색 품질 개선에 사용.
배치 처리로 메모리 효율적.`,
        inputSchema: {
            type: 'object',
            properties: {
                force: { type: 'boolean', description: '전체 재생성 (기본: false)' }
            }
        }
    }
];
// ===== 핸들러 =====
export async function handleRebuildEmbeddings(args) {
    return logger.withTool('rebuild_embeddings', async () => {
        const force = args?.force || false;
        // 대상 메모리 조회
        let sql;
        if (force) {
            sql = 'SELECT id, content FROM memories ORDER BY id';
        }
        else {
            sql = `
        SELECT m.id, m.content FROM memories m
        LEFT JOIN embeddings e ON m.id = e.memory_id
        WHERE e.memory_id IS NULL
        ORDER BY m.id
      `;
        }
        const memories = db.prepare(sql).all();
        if (memories.length === 0) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: 'No embeddings to rebuild',
                            processed: 0
                        })
                    }]
            };
        }
        logger.info('Starting embedding rebuild', {
            total: memories.length,
            force
        }, 'rebuild_embeddings');
        // 배치 처리
        const BATCH_SIZE = 10;
        let processed = 0;
        let failed = 0;
        for (let i = 0; i < memories.length; i += BATCH_SIZE) {
            const batch = memories.slice(i, i + BATCH_SIZE);
            await Promise.all(batch.map(async (memory) => {
                try {
                    const embedding = await generateEmbedding(memory.content);
                    if (embedding) {
                        const stmt = db.prepare(`
              INSERT OR REPLACE INTO embeddings (memory_id, embedding, created_at)
              VALUES (?, ?, CURRENT_TIMESTAMP)
            `);
                        stmt.run(memory.id, embeddingToBuffer(embedding));
                        processed++;
                    }
                    else {
                        failed++;
                    }
                }
                catch (e) {
                    failed++;
                    logger.error('Embedding generation failed', {
                        memoryId: memory.id,
                        error: String(e)
                    }, 'rebuild_embeddings');
                }
            }));
            // 진행 상황 로깅
            if ((i + BATCH_SIZE) % 50 === 0 || i + BATCH_SIZE >= memories.length) {
                logger.info('Embedding progress', {
                    processed,
                    failed,
                    remaining: memories.length - i - BATCH_SIZE
                }, 'rebuild_embeddings');
            }
        }
        // 최종 통계
        const totalMemories = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
        const totalEmbeddings = db.prepare('SELECT COUNT(*) as count FROM embeddings').get().count;
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        processed,
                        failed,
                        coverage: `${Math.round((totalEmbeddings / totalMemories) * 100)}%`,
                        stats: {
                            totalMemories,
                            totalEmbeddings
                        }
                    })
                }]
        };
    }, args);
}
