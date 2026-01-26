// Content Filtering 학습/회피 도구 (3개)
import { db, contentFilterPatterns, loadContentFilterPatterns } from '../db/database.js';
// ===== 도구 정의 =====
export const filterTools = [
    {
        name: 'record_filter_pattern',
        description: 'API content filtering에 걸린 패턴을 기록합니다. 비슷한 상황 회피에 사용됩니다.',
        inputSchema: {
            type: 'object',
            properties: {
                patternType: {
                    type: 'string',
                    enum: ['code_block', 'file_content', 'long_output', 'sensitive_keyword', 'binary_like', 'other'],
                    description: '패턴 유형'
                },
                patternDescription: { type: 'string', description: '어떤 상황에서 발생했는지 설명' },
                fileExtension: { type: 'string', description: '관련 파일 확장자 (선택, 예: .kt, .tsx)' },
                exampleContext: { type: 'string', description: '발생 컨텍스트 예시 (민감 정보 제외)' },
                mitigationStrategy: { type: 'string', description: '회피 전략 (예: 청크 분할, 요약만 출력)' }
            },
            required: ['patternType', 'patternDescription']
        }
    },
    {
        name: 'get_filter_patterns',
        description: '기록된 content filtering 패턴 목록을 조회합니다. 응답 생성 시 참고용.',
        inputSchema: {
            type: 'object',
            properties: {
                patternType: { type: 'string', description: '패턴 유형 필터 (선택)' },
                fileExtension: { type: 'string', description: '파일 확장자 필터 (선택)' }
            }
        }
    },
    {
        name: 'get_safe_output_guidelines',
        description: '현재 학습된 패턴 기반으로 안전한 출력 가이드라인을 반환합니다.',
        inputSchema: {
            type: 'object',
            properties: {
                context: { type: 'string', description: '현재 작업 컨텍스트 (예: kotlin 파일 분석, 긴 코드 출력)' }
            }
        }
    }
];
// ===== 핸들러 =====
export function recordFilterPattern(patternType, patternDescription, fileExtension, exampleContext, mitigationStrategy) {
    try {
        // 기존 패턴 확인
        const existingStmt = db.prepare(`
      SELECT id, occurrence_count FROM content_filter_patterns
      WHERE pattern_type = ? AND pattern_description = ?
    `);
        const existing = existingStmt.get(patternType, patternDescription);
        if (existing) {
            const updateStmt = db.prepare(`
        UPDATE content_filter_patterns
        SET occurrence_count = ?, last_occurred = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
            updateStmt.run(existing.occurrence_count + 1, existing.id);
            // 캐시 갱신
            loadContentFilterPatterns();
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            updated: true,
                            id: existing.id,
                            occurrenceCount: existing.occurrence_count + 1
                        })
                    }]
            };
        }
        else {
            const insertStmt = db.prepare(`
        INSERT INTO content_filter_patterns (pattern_type, pattern_description, file_extension, example_context, mitigation_strategy)
        VALUES (?, ?, ?, ?, ?)
      `);
            const result = insertStmt.run(patternType, patternDescription, fileExtension || null, exampleContext || null, mitigationStrategy || null);
            // 캐시 갱신
            loadContentFilterPatterns();
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            created: true,
                            id: result.lastInsertRowid
                        })
                    }]
            };
        }
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}` }],
            isError: true
        };
    }
}
export function getFilterPatterns(patternType, fileExtension) {
    try {
        let filtered = contentFilterPatterns;
        if (patternType) {
            filtered = filtered.filter(p => p.patternType === patternType);
        }
        if (fileExtension) {
            filtered = filtered.filter(p => p.fileExtension === fileExtension);
        }
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        found: filtered.length,
                        patterns: filtered
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
export function getSafeOutputGuidelines(context) {
    try {
        const guidelines = [
            '1. 긴 코드 출력 시 청크로 분할 (500줄 이하)',
            '2. 파일 전체 읽기보다 특정 섹션만 Read (offset, limit 사용)',
            '3. 불완전한 Edit 작업 후 남은 코드 정리',
            '4. 민감할 수 있는 키워드 피하기'
        ];
        // 컨텍스트에 맞는 추가 가이드라인
        if (context) {
            const contextLower = context.toLowerCase();
            if (contextLower.includes('kotlin') || contextLower.includes('.kt')) {
                guidelines.push('5. Kotlin 파일: 긴 클래스는 메서드별로 분석');
            }
            if (contextLower.includes('긴') || contextLower.includes('long')) {
                guidelines.push('5. 긴 출력: 요약 먼저 제공, 상세 내용은 요청 시');
            }
        }
        // 학습된 패턴 기반 추가 가이드라인
        const patternGuidelines = contentFilterPatterns
            .filter(p => p.mitigationStrategy)
            .slice(0, 3)
            .map((p, i) => `${guidelines.length + i + 1}. ${p.mitigationStrategy}`);
        return {
            content: [{
                    type: 'text',
                    text: JSON.stringify({
                        context: context || 'general',
                        guidelines: [...guidelines, ...patternGuidelines],
                        learnedPatternsCount: contentFilterPatterns.length
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
