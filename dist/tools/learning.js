// 자동 학습 시스템 도구 (6개)
import { db } from '../db/database.js';
import { generateEmbedding, embeddingToBuffer, getEmbeddingPipeline } from '../utils/embedding.js';
import { semanticSearch } from './embedding.js';
// ===== 도구 정의 =====
export const learningTools = [
    {
        name: 'auto_learn_decision',
        description: '아키텍처/기술 결정 사항을 자동 기록합니다. 왜 이 선택을 했는지 기록하여 나중에 참조할 수 있습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                decision: { type: 'string', description: '결정 내용 (예: Socket.IO 대신 WebSocket 사용)' },
                reason: { type: 'string', description: '결정 이유' },
                context: { type: 'string', description: '결정 배경/맥락' },
                alternatives: { type: 'array', items: { type: 'string' }, description: '고려했던 대안들' },
                files: { type: 'array', items: { type: 'string' }, description: '관련 파일들' }
            },
            required: ['project', 'decision', 'reason']
        }
    },
    {
        name: 'auto_learn_fix',
        description: '에러/버그 해결 방법을 자동 기록합니다. 비슷한 에러 발생 시 참조할 수 있습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                error: { type: 'string', description: '에러 메시지 또는 증상' },
                cause: { type: 'string', description: '원인 (선택)' },
                solution: { type: 'string', description: '해결 방법' },
                files: { type: 'array', items: { type: 'string' }, description: '수정한 파일들' },
                preventionTip: { type: 'string', description: '재발 방지 팁 (선택)' }
            },
            required: ['project', 'error', 'solution']
        }
    },
    {
        name: 'auto_learn_pattern',
        description: '프로젝트의 코드 패턴/컨벤션을 자동 기록합니다. 일관성 유지에 활용됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                patternName: { type: 'string', description: '패턴 이름 (예: Repository 패턴, State hoisting)' },
                description: { type: 'string', description: '패턴 설명' },
                example: { type: 'string', description: '예시 코드나 파일 경로' },
                appliesTo: { type: 'string', description: '적용 대상 (예: 모든 Repository, Compose UI)' }
            },
            required: ['project', 'patternName', 'description']
        }
    },
    {
        name: 'auto_learn_dependency',
        description: '의존성 변경 사항을 자동 기록합니다. 버전 충돌이나 업그레이드 시 참조합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                dependency: { type: 'string', description: '의존성 이름' },
                action: { type: 'string', enum: ['add', 'remove', 'upgrade', 'downgrade'], description: '작업 유형' },
                fromVersion: { type: 'string', description: '이전 버전 (선택)' },
                toVersion: { type: 'string', description: '새 버전 (선택)' },
                reason: { type: 'string', description: '변경 이유' },
                breakingChanges: { type: 'string', description: 'Breaking changes 내용 (선택)' }
            },
            required: ['project', 'dependency', 'action', 'reason']
        }
    },
    {
        name: 'get_project_knowledge',
        description: '프로젝트에서 학습된 모든 지식을 조회합니다. 결정, 해결, 패턴, 의존성 변경 등.',
        inputSchema: {
            type: 'object',
            properties: {
                project: { type: 'string', description: '프로젝트명' },
                knowledgeType: {
                    type: 'string',
                    enum: ['all', 'decision', 'fix', 'pattern', 'dependency'],
                    description: '지식 유형 필터 (기본: all)'
                },
                limit: { type: 'number', description: '최대 결과 수 (기본: 20)' }
            },
            required: ['project']
        }
    },
    {
        name: 'get_similar_issues',
        description: '비슷한 에러/이슈의 해결 방법을 검색합니다. 시맨틱 검색으로 유사한 문제를 찾습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                errorOrIssue: { type: 'string', description: '에러 메시지 또는 이슈 설명' },
                project: { type: 'string', description: '특정 프로젝트에서만 검색 (선택)' },
                limit: { type: 'number', description: '최대 결과 수 (기본: 5)' }
            },
            required: ['errorOrIssue']
        }
    }
];
// ===== 핸들러 =====
export async function autoLearnDecision(args) {
    try {
        const content = `[DECISION] ${args.decision}\n이유: ${args.reason}${args.context ? `\n맥락: ${args.context}` : ''}${args.alternatives?.length ? `\n대안들: ${args.alternatives.join(', ')}` : ''}`;
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'decision', ?, ?, 7, ?)
    `);
        const tags = JSON.stringify(['auto-learn', 'architecture', 'decision']);
        const metadata = JSON.stringify({
            type: 'decision',
            alternatives: args.alternatives,
            files: args.files
        });
        const result = stmt.run(content, tags, args.project, metadata);
        const memoryId = result.lastInsertRowid;
        // 임베딩 생성
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                const embStmt = db.prepare('INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)');
                embStmt.run(memoryId, embeddingToBuffer(embedding));
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ success: true, id: memoryId, type: 'decision' })
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
export async function autoLearnFix(args) {
    try {
        const content = `[FIX] ${args.error}\n해결: ${args.solution}${args.cause ? `\n원인: ${args.cause}` : ''}${args.preventionTip ? `\n예방: ${args.preventionTip}` : ''}`;
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'error', ?, ?, 8, ?)
    `);
        const tags = JSON.stringify(['auto-learn', 'fix', 'error-solution']);
        const metadata = JSON.stringify({
            type: 'fix',
            error: args.error,
            solution: args.solution,
            cause: args.cause,
            files: args.files,
            preventionTip: args.preventionTip
        });
        const result = stmt.run(content, tags, args.project, metadata);
        const memoryId = result.lastInsertRowid;
        // 임베딩 생성
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                const embStmt = db.prepare('INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)');
                embStmt.run(memoryId, embeddingToBuffer(embedding));
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ success: true, id: memoryId, type: 'fix' })
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
export async function autoLearnPattern(args) {
    try {
        const content = `[PATTERN] ${args.patternName}\n설명: ${args.description}${args.example ? `\n예시: ${args.example}` : ''}${args.appliesTo ? `\n적용대상: ${args.appliesTo}` : ''}`;
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'pattern', ?, ?, 6, ?)
    `);
        const tags = JSON.stringify(['auto-learn', 'code-pattern', 'convention']);
        const metadata = JSON.stringify({
            type: 'pattern',
            patternName: args.patternName,
            appliesTo: args.appliesTo
        });
        const result = stmt.run(content, tags, args.project, metadata);
        const memoryId = result.lastInsertRowid;
        // 임베딩 생성
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                const embStmt = db.prepare('INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)');
                embStmt.run(memoryId, embeddingToBuffer(embedding));
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ success: true, id: memoryId, type: 'pattern' })
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
export async function autoLearnDependency(args) {
    try {
        const versionInfo = args.fromVersion && args.toVersion
            ? `${args.fromVersion} → ${args.toVersion}`
            : args.toVersion || args.fromVersion || '';
        const content = `[DEPENDENCY] ${args.action.toUpperCase()} ${args.dependency} ${versionInfo}\n이유: ${args.reason}${args.breakingChanges ? `\nBreaking Changes: ${args.breakingChanges}` : ''}`;
        const stmt = db.prepare(`
      INSERT INTO memories (content, memory_type, tags, project, importance, metadata)
      VALUES (?, 'learning', ?, ?, 5, ?)
    `);
        const tags = JSON.stringify(['auto-learn', 'dependency', args.action]);
        const metadata = JSON.stringify({
            type: 'dependency',
            dependency: args.dependency,
            action: args.action,
            fromVersion: args.fromVersion,
            toVersion: args.toVersion,
            breakingChanges: args.breakingChanges
        });
        const result = stmt.run(content, tags, args.project, metadata);
        const memoryId = result.lastInsertRowid;
        // 임베딩 생성
        generateEmbedding(content).then(embedding => {
            if (embedding) {
                const embStmt = db.prepare('INSERT OR REPLACE INTO embeddings (memory_id, embedding) VALUES (?, ?)');
                embStmt.run(memoryId, embeddingToBuffer(embedding));
            }
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({ success: true, id: memoryId, type: 'dependency' })
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
export function getProjectKnowledge(project, knowledgeType = 'all', limit = 20) {
    try {
        let sql = `
      SELECT id, content, memory_type, tags, importance, metadata, created_at
      FROM memories
      WHERE project = ?
      AND tags LIKE '%"auto-learn"%'
    `;
        const params = [project];
        if (knowledgeType !== 'all') {
            const typeMap = {
                decision: 'decision',
                fix: 'error',
                pattern: 'pattern',
                dependency: 'learning'
            };
            sql += ` AND memory_type = ?`;
            params.push(typeMap[knowledgeType] || knowledgeType);
        }
        sql += ` ORDER BY importance DESC, created_at DESC LIMIT ?`;
        params.push(limit);
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        const knowledge = rows.map(row => {
            let meta = {};
            try {
                meta = JSON.parse(row.metadata || '{}');
            }
            catch { }
            return {
                id: row.id,
                type: meta.type || row.memory_type,
                content: row.content,
                importance: row.importance,
                createdAt: row.created_at,
                metadata: meta
            };
        });
        // 유형별 통계
        const stats = {
            decision: knowledge.filter(k => k.type === 'decision').length,
            fix: knowledge.filter(k => k.type === 'fix').length,
            pattern: knowledge.filter(k => k.type === 'pattern').length,
            dependency: knowledge.filter(k => k.type === 'dependency').length
        };
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        project,
                        totalKnowledge: knowledge.length,
                        stats,
                        knowledge: knowledge.slice(0, limit)
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
export async function getSimilarIssues(errorOrIssue, project, limit = 5) {
    try {
        // 먼저 시맨틱 검색 시도
        if (getEmbeddingPipeline()) {
            const result = await semanticSearch(errorOrIssue, limit, 0.3, 'error', project);
            const resultText = JSON.parse(result.content[0].text);
            if (resultText.found > 0) {
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                searchType: 'semantic',
                                query: errorOrIssue.substring(0, 100),
                                found: resultText.found,
                                solutions: resultText.results.map((r) => ({
                                    id: r.id,
                                    similarity: r.similarity,
                                    content: r.content,
                                    project: r.project
                                }))
                            }, null, 2)
                        }]
                };
            }
        }
        // 시맨틱 검색 결과 없으면 FTS 검색
        const keywords = errorOrIssue.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
        const ftsQuery = keywords.join(' OR ');
        let query = `
      SELECT m.id, m.content, m.project, m.metadata
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
      AND m.memory_type = 'error'
    `;
        const params = [ftsQuery];
        if (project) {
            query += ` AND m.project = ?`;
            params.push(project);
        }
        query += ` LIMIT ?`;
        params.push(limit);
        const stmt = db.prepare(query);
        const rows = stmt.all(...params);
        const solutions = rows.map(row => {
            let metadata = {};
            try {
                metadata = JSON.parse(row.metadata || '{}');
            }
            catch { }
            return {
                id: row.id,
                content: row.content,
                project: row.project,
                solution: metadata.solution
            };
        });
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        searchType: 'fts',
                        query: errorOrIssue.substring(0, 100),
                        found: solutions.length,
                        solutions
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
