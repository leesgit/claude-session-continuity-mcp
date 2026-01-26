export declare function initEmbedding(): Promise<void>;
export declare function generateEmbedding(text: string): Promise<number[] | null>;
export declare function cosineSimilarity(a: number[], b: number[]): number;
export declare function embeddingToBuffer(embedding: number[]): Buffer;
export declare function bufferToEmbedding(buffer: Buffer): number[];
export declare function isEmbeddingReady(): boolean;
export declare function getEmbeddingPipeline(): unknown;
