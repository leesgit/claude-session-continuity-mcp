// 피드백 수집 도구 (3개)
import { db } from '../db/database.js';
// ===== 도구 정의 =====
export const feedbackTools = [
    {
        name: 'collect_work_feedback',
        description: '/work 작업 완료 시 자동으로 피드백을 수집합니다. 에러, 타임아웃, 불편사항 등을 기록합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '작업한 프로젝트 이름' },
                workSummary: { type: 'string', description: '수행한 작업 요약' },
                feedbackType: {
                    type: 'string',
                    enum: ['bug', 'timeout', 'feature-request', 'ux', 'performance', 'none'],
                    description: '피드백 유형 (none: 피드백 없음)'
                },
                feedbackContent: { type: 'string', description: '피드백 내용 (feedbackType이 none이 아닐 때)' },
                affectedTool: { type: 'string', description: '문제가 발생한 MCP 도구명 (선택)' },
                verificationPassed: { type: 'boolean', description: '검증 통과 여부' },
                duration: { type: 'number', description: '작업 소요 시간 (분)' }
            },
            required: ['project', 'workSummary', 'feedbackType', 'verificationPassed']
        }
    },
    {
        name: 'get_pending_feedbacks',
        description: '해결되지 않은 피드백 목록을 중요도순으로 조회합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                feedbackType: { type: 'string', description: '피드백 유형 필터 (선택)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 20)' }
            }
        }
    },
    {
        name: 'resolve_feedback',
        description: '피드백을 해결 완료 처리합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                feedbackId: { type: 'number', description: '해결된 피드백 ID' },
                resolution: { type: 'string', description: '해결 방법 설명' }
            },
            required: ['feedbackId']
        }
    }
];
// ===== 핸들러 =====
export function collectWorkFeedback(project, workSummary, feedbackType, verificationPassed, feedbackContent, affectedTool, duration) {
    try {
        if (feedbackType === 'none') {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: true, feedbackRecorded: false, message: 'No feedback to record' })
                    }]
            };
        }
        // 피드백 중요도 계산
        const importanceMap = {
            bug: 8,
            timeout: 7,
            performance: 6,
            'feature-request': 5,
            ux: 4
        };
        const importance = importanceMap[feedbackType] || 5;
        // memories 테이블에 피드백 저장
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'observation', ?, ?, ?, ?)
    `);
        const tags = JSON.stringify(['feedback', feedbackType, 'mcp']);
        const metadata = JSON.stringify({
            feedbackType,
            affectedTool,
            workSummary,
            verificationPassed,
            duration,
            resolved: false
        });
        const result = stmt.run(feedbackContent || `${feedbackType}: ${workSummary}`, tags, project, importance, metadata);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        feedbackRecorded: true,
                        id: result.lastInsertRowid,
                        feedbackType,
                        importance
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
export function getPendingFeedbacks(feedbackType, limit = 20) {
    try {
        let sql = `
      SELECT id, content, project, importance, metadata, created_at
      FROM memories
      WHERE tags LIKE '%"feedback"%'
      AND JSON_EXTRACT(metadata, '$.resolved') = 0
    `;
        const params = [];
        if (feedbackType) {
            sql += ` AND tags LIKE ?`;
            params.push(`%"${feedbackType}"%`);
        }
        sql += ` ORDER BY importance DESC, created_at DESC LIMIT ?`;
        params.push(limit);
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        const feedbacks = rows.map(row => {
            let meta = {};
            try {
                meta = JSON.parse(row.metadata || '{}');
            }
            catch { }
            return {
                id: row.id,
                content: row.content,
                project: row.project,
                importance: row.importance,
                feedbackType: meta.feedbackType,
                affectedTool: meta.affectedTool,
                createdAt: row.created_at
            };
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        found: feedbacks.length,
                        feedbacks
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
export function resolveFeedback(feedbackId, resolution) {
    try {
        // 현재 metadata 가져오기
        const getStmt = db.prepare('SELECT metadata FROM memories WHERE id = ?');
        const row = getStmt.get(feedbackId);
        if (!row) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ success: false, error: 'Feedback not found' })
                    }],
                isError: true
            };
        }
        let metadata = {};
        try {
            metadata = JSON.parse(row.metadata || '{}');
        }
        catch { }
        metadata.resolved = true;
        metadata.resolvedAt = new Date().toISOString();
        if (resolution) {
            metadata.resolution = resolution;
        }
        const updateStmt = db.prepare(`
      UPDATE memories SET metadata = ? WHERE id = ?
    `);
        updateStmt.run(JSON.stringify(metadata), feedbackId);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        feedbackId,
                        resolved: true
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
