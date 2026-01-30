#!/usr/bin/env npx ts-node
/**
 * 기존 메모리들의 임베딩을 배치로 생성
 *
 * 사용법: npx ts-node scripts/generate-embeddings.ts
 */

import Database from 'better-sqlite3';
import * as path from 'path';
// @ts-ignore
import { pipeline, env } from '@xenova/transformers';

// 모델 캐시 설정
env.cacheDir = path.join(process.env.HOME || '/tmp', '.cache', 'transformers');
env.allowLocalModels = true;

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/Users/ibyeongchang/Documents/dev/ai-service-generator';
const DB_PATH = path.join(WORKSPACE_ROOT, '.claude', 'sessions.db');

async function main() {
  console.log('🚀 임베딩 생성 시작...\n');

  // 임베딩 파이프라인 로드
  console.log('📦 모델 로딩 중... (최초 실행 시 다운로드)');
  const embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log('✅ 모델 로드 완료\n');

  const db = new Database(DB_PATH);

  // 임베딩 없는 메모리 조회
  const memories = db.prepare(`
    SELECT m.id, m.content
    FROM memories m
    LEFT JOIN embeddings_v4 e ON e.entity_type = 'memory' AND e.entity_id = m.id
    WHERE e.id IS NULL
  `).all() as { id: number; content: string }[];

  console.log(`📝 임베딩이 필요한 메모리: ${memories.length}개\n`);

  if (memories.length === 0) {
    console.log('✨ 모든 메모리에 임베딩이 있습니다.');
    db.close();
    return;
  }

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO embeddings_v4 (entity_type, entity_id, embedding, model)
    VALUES ('memory', ?, ?, 'all-MiniLM-L6-v2')
  `);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];
    process.stdout.write(`\r[${i + 1}/${memories.length}] ID: ${memory.id}`);

    try {
      const output = await embeddingPipeline(memory.content, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data);
      const buffer = Buffer.from(new Float32Array(embedding).buffer);

      insertStmt.run(memory.id, buffer);
      successCount++;
    } catch (error) {
      console.error(`\n❌ ID ${memory.id} 실패:`, error);
      errorCount++;
    }
  }

  db.close();

  console.log(`\n\n✅ 완료!`);
  console.log(`   성공: ${successCount}개`);
  console.log(`   실패: ${errorCount}개`);
}

main().catch(console.error);
