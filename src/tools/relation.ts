// 지식 그래프 관계 도구 (2개)
import { db } from '../db/database.js';
import type { Tool, CallToolResult } from '../types.js';

// ===== 도구 정의 =====

export const relationTools: Tool[] = [
  {
    name: 'create_relation',
    description: '두 메모리 간의 관계를 생성합니다. (지식 그래프)',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'number', description: '출발 메모리 ID' },
        targetId: { type: 'number', description: '도착 메모리 ID' },
        relationType: {
          type: 'string',
          enum: ['related_to', 'causes', 'solves', 'depends_on', 'contradicts', 'extends', 'example_of'],
          description: '관계 유형'
        },
        strength: { type: 'number', description: '관계 강도 0-1 (기본: 1.0)' }
      },
      required: ['sourceId', 'targetId', 'relationType']
    }
  },
  {
    name: 'find_connected_memories',
    description: '특정 메모리와 연결된 모든 메모리를 찾습니다. (지식 그래프 탐색)',
    inputSchema: {
      type: 'object',
      properties: {
        memoryId: { type: 'number', description: '기준 메모리 ID' },
        depth: { type: 'number', description: '탐색 깊이 (기본: 1, 최대: 3)' },
        relationType: { type: 'string', description: '관계 유형 필터 (선택)' }
      },
      required: ['memoryId']
    }
  }
];

// ===== 핸들러 =====

export function createRelation(
  sourceId: number,
  targetId: number,
  relationType: string,
  strength: number = 1.0
): CallToolResult {
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO memory_relations (source_id, target_id, relation_type, strength)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(sourceId, targetId, relationType, strength);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: true,
          id: result.lastInsertRowid,
          relation: { sourceId, targetId, relationType, strength }
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

export function findConnectedMemories(
  memoryId: number,
  depth: number = 1,
  relationType?: string
): CallToolResult {
  try {
    const maxDepth = Math.min(depth, 3);
    const visited = new Set<number>();
    const connections: Array<{
      memoryId: number;
      content: string;
      relationType: string;
      strength: number;
      depth: number;
      direction: 'outgoing' | 'incoming';
    }> = [];

    function explore(currentId: number, currentDepth: number) {
      if (currentDepth > maxDepth || visited.has(currentId)) return;
      visited.add(currentId);

      // 나가는 관계
      let outgoingSql = `
        SELECT r.target_id, r.relation_type, r.strength, m.content
        FROM memory_relations r
        JOIN memories m ON m.id = r.target_id
        WHERE r.source_id = ?
      `;
      const outgoingParams: unknown[] = [currentId];

      if (relationType) {
        outgoingSql += ` AND r.relation_type = ?`;
        outgoingParams.push(relationType);
      }

      const outgoingStmt = db.prepare(outgoingSql);
      const outgoingRows = outgoingStmt.all(...outgoingParams) as Array<{
        target_id: number;
        relation_type: string;
        strength: number;
        content: string;
      }>;

      for (const row of outgoingRows) {
        if (row.target_id !== memoryId) {
          connections.push({
            memoryId: row.target_id,
            content: row.content.substring(0, 200),
            relationType: row.relation_type,
            strength: row.strength,
            depth: currentDepth,
            direction: 'outgoing'
          });
          explore(row.target_id, currentDepth + 1);
        }
      }

      // 들어오는 관계
      let incomingSql = `
        SELECT r.source_id, r.relation_type, r.strength, m.content
        FROM memory_relations r
        JOIN memories m ON m.id = r.source_id
        WHERE r.target_id = ?
      `;
      const incomingParams: unknown[] = [currentId];

      if (relationType) {
        incomingSql += ` AND r.relation_type = ?`;
        incomingParams.push(relationType);
      }

      const incomingStmt = db.prepare(incomingSql);
      const incomingRows = incomingStmt.all(...incomingParams) as Array<{
        source_id: number;
        relation_type: string;
        strength: number;
        content: string;
      }>;

      for (const row of incomingRows) {
        if (row.source_id !== memoryId) {
          connections.push({
            memoryId: row.source_id,
            content: row.content.substring(0, 200),
            relationType: row.relation_type,
            strength: row.strength,
            depth: currentDepth,
            direction: 'incoming'
          });
          explore(row.source_id, currentDepth + 1);
        }
      }
    }

    explore(memoryId, 1);

    // 중복 제거
    const uniqueConnections = connections.filter((conn, index, self) =>
      index === self.findIndex(c => c.memoryId === conn.memoryId && c.relationType === conn.relationType)
    );

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          rootMemoryId: memoryId,
          maxDepth,
          found: uniqueConnections.length,
          connections: uniqueConnections
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
