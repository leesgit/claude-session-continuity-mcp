// Codex CLI integration tests (2026-07-09)
// Covers host detection and host-aware context output — the two spots where
// the audit-7 review found bugs (transcript_path=null, DRY-duplicated detection).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCodexHost, emitContext } from '../src/utils/logger.js';

describe('isCodexHost', () => {
  const origArgv = process.argv;
  afterEach(() => { process.argv = origArgv; });

  it('detects Codex via the --codex argv marker even when transcript_path is null', () => {
    process.argv = [...origArgv, '--codex'];
    // This is the fresh-SessionStart case: Codex passes transcript_path=null.
    expect(isCodexHost(undefined)).toBe(true);
    expect(isCodexHost('')).toBe(true);
  });

  it('detects Codex via a rollout transcript path', () => {
    process.argv = origArgv.filter(a => a !== '--codex');
    expect(isCodexHost('/Users/x/.codex/sessions/2026/rollout-abc.jsonl')).toBe(true);
    expect(isCodexHost('/anywhere/rollout-xyz.jsonl')).toBe(true);
  });

  it('returns false for Claude paths and empty input (no marker)', () => {
    process.argv = origArgv.filter(a => a !== '--codex');
    expect(isCodexHost('/Users/x/.claude/projects/foo/abc.jsonl')).toBe(false);
    expect(isCodexHost(undefined)).toBe(false);
    expect(isCodexHost('')).toBe(false);
  });
});

describe('emitContext', () => {
  const origArgv = process.argv;
  afterEach(() => { process.argv = origArgv; vi.restoreAllMocks(); });

  it('emits {hookSpecificOutput:{additionalContext}} JSON for Codex', () => {
    process.argv = [...origArgv, '--codex'];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    emitContext('hello', 'SessionStart', null as unknown as string);
    expect(spy).toHaveBeenCalledOnce();
    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(payload.hookSpecificOutput.additionalContext).toBe('hello');
  });

  it('emits plain text via console.log for Claude', () => {
    process.argv = origArgv.filter(a => a !== '--codex');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitContext('hello', 'SessionStart', '/Users/x/.claude/projects/foo/abc.jsonl');
    expect(spy).toHaveBeenCalledWith('hello');
  });
});
