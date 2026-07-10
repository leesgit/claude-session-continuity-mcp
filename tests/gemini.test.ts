// Gemini CLI integration tests (2026-07-10)
// Covers host detection and host-aware output. Gemini shares Codex's stdout shape
// (hookSpecificOutput.additionalContext) but has its own transcript format + hook events.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isGeminiHost, isCodexHost, emitContext } from '../src/utils/logger.js';

describe('isGeminiHost', () => {
  const origArgv = process.argv;
  afterEach(() => { process.argv = origArgv; });

  it('detects Gemini via the --gemini argv marker even when transcript_path is null', () => {
    process.argv = [...origArgv, '--gemini'];
    // Fresh-SessionStart case: Gemini's transcript_path is stubbed/null (#14715).
    expect(isGeminiHost(undefined)).toBe(true);
    expect(isGeminiHost('')).toBe(true);
  });

  it('detects Gemini via a ~/.gemini/tmp chat transcript path', () => {
    process.argv = origArgv.filter(a => a !== '--gemini');
    expect(isGeminiHost('/Users/x/.gemini/tmp/abc123/chats/session.jsonl')).toBe(true);
  });

  it('does not confuse Gemini with Codex or Claude', () => {
    process.argv = origArgv.filter(a => a !== '--gemini' && a !== '--codex');
    expect(isGeminiHost('/Users/x/.codex/sessions/2026/rollout-x.jsonl')).toBe(false);
    expect(isGeminiHost('/Users/x/.claude/projects/foo/abc.jsonl')).toBe(false);
    expect(isCodexHost('/Users/x/.gemini/tmp/abc/chats/s.jsonl')).toBe(false);
  });
});

describe('emitContext (Gemini)', () => {
  const origArgv = process.argv;
  afterEach(() => { process.argv = origArgv; vi.restoreAllMocks(); });

  it('emits {hookSpecificOutput:{additionalContext}} JSON for Gemini (same as Codex)', () => {
    process.argv = [...origArgv, '--gemini'];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    emitContext('hello', 'SessionStart', null as unknown as string);
    expect(spy).toHaveBeenCalledOnce();
    const payload = JSON.parse(spy.mock.calls[0][0] as string);
    expect(payload.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(payload.hookSpecificOutput.additionalContext).toBe('hello');
  });

  it('still emits plain text for Claude (no marker)', () => {
    process.argv = origArgv.filter(a => a !== '--gemini' && a !== '--codex');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    emitContext('hello', 'SessionStart', '/Users/x/.claude/projects/foo/abc.jsonl');
    expect(spy).toHaveBeenCalledWith('hello');
  });
});
