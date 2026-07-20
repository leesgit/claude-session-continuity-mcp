// End-to-end toggle regression (audit-7 2026-07-20).
// Spawns the REAL compiled session-end hook against an isolated temp DB + fake
// transcript, then asserts solutionCapture / strictSolutionGate actually change
// what lands in the `solutions` table — while the `sessions` row is always saved.
//
// This is the test that would have caught the "dead config" bug: a unit test of
// isEnabled() can't, because the gap was the hook never READING the flag.
//
// Requires `npm run build` first (reads dist/hooks/session-end.js). If dist is
// missing the suite skips rather than failing spuriously.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(here, '../dist/hooks/session-end.js');
const hookBuilt = fs.existsSync(HOOK);

// The hook opens `${workspaceRoot}/.claude/sessions.db` and assumes the schema
// already exists (the MCP server creates it). We create the minimal tables it
// writes to.
function initSchema(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, last_work TEXT NOT NULL,
      current_status TEXT, next_tasks TEXT, modified_files TEXT, issues TEXT,
      verification_result TEXT, duration_minutes INTEGER
    );
    CREATE TABLE IF NOT EXISTS solutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT,
      error_signature TEXT NOT NULL, error_message TEXT, solution TEXT NOT NULL,
      related_files TEXT, keywords TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL,
      memory_type TEXT NOT NULL DEFAULT 'observation', tags TEXT, project TEXT,
      importance INTEGER DEFAULT 5, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP, access_count INTEGER DEFAULT 0,
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS project_context (
      project TEXT PRIMARY KEY, tech_stack TEXT, architecture_decisions TEXT,
      code_patterns TEXT, special_notes TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS active_context (
      project TEXT PRIMARY KEY, current_state TEXT, active_tasks TEXT,
      recent_files TEXT, blockers TEXT, last_verification TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.close();
}

// A transcript where errorRe matches an entry and fixRe matches a following one
// (window of 1..3), producing errorFixPairs. Includes 3 real errors + 1 noise
// line, so strictSolutionGate has something to filter.
function fakeTranscript(): string {
  const lines = [
    { type: 'user', message: { content: 'Build is broken, help.' } },
    { type: 'assistant', message: { content: 'TypeError: Cannot read properties of undefined reading map' } },
    { type: 'assistant', message: { content: '수정 완료 — null 체크를 추가해서 해결했습니다. 이제 정상 동작합니다.' } },
    { type: 'assistant', message: { content: 'ReferenceError: fetchData is not defined in scope' } },
    { type: 'assistant', message: { content: '해결됨 — import 누락이었고 상단에 추가해 커밋했습니다 (한 줄 반영).' } },
    { type: 'assistant', message: { content: 'Error: MODULE_NOT_FOUND for better-sqlite3 native binding' } },
    { type: 'assistant', message: { content: '고침 — node 22 재빌드로 처리했고 문제 해결을 확인했습니다.' } },
    // noise: errorRe matches '실패:' but this is narration, not a real signature
    { type: 'assistant', message: { content: '실패: 사례를 정리해 봅니다 그렇습니다 findings 정리 완료했습니다.' } },
    { type: 'assistant', message: { content: '정리 완료했습니다 — 다음 단계로 넘어가면 되겠습니다 그렇습니다.' } },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

interface RunResult { solutions: number; sessions: number; stdout: string; }

function runHook(env: Record<string, string> = {}): RunResult {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-e2e-'));
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  const dbPath = path.join(ws, '.claude', 'sessions.db');
  initSchema(dbPath);

  const tpath = path.join(ws, 'transcript.jsonl');
  fs.writeFileSync(tpath, fakeTranscript());

  const input = JSON.stringify({ session_id: 'e2e', transcript_path: tpath, cwd: ws });
  const res = spawnSync('node', [HOOK], {
    input,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });

  const db = new Database(dbPath, { readonly: true });
  const solutions = (db.prepare('SELECT COUNT(*) c FROM solutions').get() as { c: number }).c;
  const sessions = (db.prepare('SELECT COUNT(*) c FROM sessions').get() as { c: number }).c;
  db.close();

  createdRoots.push(ws);
  return { solutions, sessions, stdout: (res.stdout || '') + (res.stderr || '') };
}

const createdRoots: string[] = [];
afterEach(() => {
  while (createdRoots.length) {
    try { fs.rmSync(createdRoots.pop()!, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

describe.skipIf(!hookBuilt)('session-end hook — toggle E2E', () => {
  let baseline = 0;

  beforeAll(() => {
    // default (solutionCapture on, strict off): record what the fixture yields
    // so the assertions are relative and don't hard-code fixture internals.
    baseline = runHook().solutions;
  });

  it('default (solutionCapture on, strict off): records solutions AND saves session', () => {
    const r = runHook();
    expect(r.solutions).toBeGreaterThan(0);
    expect(r.sessions).toBe(1);
  });

  it('solutionCapture OFF: zero solutions, session still saved', () => {
    const r = runHook({ PASSBATON_SOLUTIONCAPTURE: '0' });
    expect(r.solutions).toBe(0);          // the negative test the unit suite can't do
    expect(r.sessions).toBe(1);           // session save is decoupled from the gate
  });

  it('strictSolutionGate ON: fewer solutions than the lenient default (drops noise)', () => {
    const strict = runHook({ PASSBATON_STRICTSOLUTIONGATE: '1' }).solutions;
    expect(strict).toBeLessThan(baseline); // strict filters the noise line
    expect(strict).toBeGreaterThan(0);     // but keeps the real errors
  });

  it('config FILE (no env) with solutionCapture off is honored too', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-e2e-'));
    fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
    const dbPath = path.join(ws, '.claude', 'sessions.db');
    initSchema(dbPath);
    fs.writeFileSync(
      path.join(ws, '.claude', 'passbaton.config.json'),
      JSON.stringify({ version: 1, features: { solutionCapture: { enabled: false } } }),
    );
    const tpath = path.join(ws, 'transcript.jsonl');
    fs.writeFileSync(tpath, fakeTranscript());
    spawnSync('node', [HOOK], {
      input: JSON.stringify({ session_id: 'e2e', transcript_path: tpath, cwd: ws }),
      encoding: 'utf-8',
    });
    const db = new Database(dbPath, { readonly: true });
    const solutions = (db.prepare('SELECT COUNT(*) c FROM solutions').get() as { c: number }).c;
    db.close();
    createdRoots.push(ws);
    expect(solutions).toBe(0); // file-based config, not just env, gates the write
  });
});
