// 공통 유틸리티 함수
import * as fs from 'fs/promises';
import * as path from 'path';

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function writeFileContent(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

export function parseMarkdownTable(content: string, tableName: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split('\n');
  let inTable = false;

  for (const line of lines) {
    if (line.includes(tableName)) {
      inTable = true;
      continue;
    }
    if (inTable && line.startsWith('|') && !line.includes('---')) {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2 && cells[0] !== '항목' && cells[0] !== '작업') {
        result[cells[0]] = cells[1];
      }
    }
    if (inTable && line.trim() === '') {
      inTable = false;
    }
  }

  return result;
}
