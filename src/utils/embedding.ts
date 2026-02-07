// 임베딩 관련 유틸리티
import * as path from 'path';
// @ts-ignore - transformers.js
import { pipeline, env } from '@xenova/transformers';

// 모델 캐시 설정
env.cacheDir = path.join(process.env.HOME || '/tmp', '.cache', 'transformers');
env.allowLocalModels = true;

// 임베딩 파이프라인
let embeddingPipeline: unknown = null;
let embeddingReady = false;

export async function initEmbedding() {
  if (embeddingPipeline) return;
  try {
    console.error('Loading embedding model (first time may take a while)...');
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');
    embeddingReady = true;
    console.error('Embedding model loaded successfully!');
  } catch (error) {
    console.error('Failed to load embedding model:', error);
  }
}

// 백그라운드에서 모델 로드 시작
initEmbedding();

export async function generateEmbedding(text: string, type: 'query' | 'passage' = 'query'): Promise<number[] | null> {
  if (!embeddingPipeline) {
    await initEmbedding();
  }
  if (!embeddingPipeline) return null;

  try {
    const prefixedText = `${type}: ${text}`;
    const output = await (embeddingPipeline as (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>)(
      prefixedText,
      { pooling: 'mean', normalize: true }
    );
    return Array.from(output.data);
  } catch (error) {
    console.error('Embedding generation error:', error);
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function embeddingToBuffer(embedding: number[]): Buffer {
  const float32Array = new Float32Array(embedding);
  return Buffer.from(float32Array.buffer);
}

export function bufferToEmbedding(buffer: Buffer): number[] {
  const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  return Array.from(float32Array);
}

export function isEmbeddingReady(): boolean {
  return embeddingReady;
}

export function getEmbeddingPipeline(): unknown {
  return embeddingPipeline;
}
