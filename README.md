# claude-session-continuity-mcp (v1.12.0)

> **Zero Re-explanation Session Continuity for Claude Code** — Automatic context capture + semantic search + auto error→solution pipeline

[![npm version](https://img.shields.io/npm/v/claude-session-continuity-mcp.svg)](https://www.npmjs.com/package/claude-session-continuity-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-111%20passed-brightgreen.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)]()

## The Problem

Every new Claude Code session:

```
"This is a Next.js 15 project with App Router..."
"We decided to use Server Actions because..."
"Last time we were working on the auth system..."
"The build command is pnpm build..."
```

**5 minutes of context-setting. Every. Single. Time.**

## The Solution

**Fully automatic.** Claude Hooks handle everything without manual calls:

```bash
# Session start → Auto-loads relevant context + recent session history
# When asking → Auto-injects relevant memories/solutions
# During conversation → Tracks active files + auto-injects error solutions
# On compact → Structured handover context for continuity
# On exit → Extracts commits, decisions, error-fix pairs from transcript
```

```
← Auto-output on session start:
# my-app - Session Resumed

📍 **State**: Implementing signup form

## Recent Sessions
### 2026-02-28
**Work**: Completed OAuth integration with Google provider
**Commits**: feat: add OAuth callback handler; fix: redirect URI config
**Decisions**: Use Server Actions instead of API routes

### 2026-02-27
**Work**: Set up authentication foundation
**Next**: Implement signup form validation

## Directives
- 🔴 Always use Zod for form validation
- 📎 Prefer Server Components by default

## Key Memories
- 🎯 Decided on App Router, using Server Actions
- ⚠️ OAuth redirect_uri mismatch → check env file
```

**Zero manual work. Context follows you.**

---

## Quick Start

### One Command Installation

```bash
npm install claude-session-continuity-mcp
```

**That's it!** The postinstall script automatically:
1. Registers MCP server in `~/.claude.json`
2. Installs Claude Hooks in `~/.claude/settings.json`

### What Gets Installed

**MCP Server** (in `~/.claude.json`):
```json
{
  "mcpServers": {
    "project-manager": {
      "command": "npx",
      "args": ["claude-session-continuity-mcp"]
    }
  }
}
```

**Claude Hooks** (in `~/.claude/settings.json`):
```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "npm exec -- claude-hook-session-start" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "npm exec -- claude-hook-user-prompt" }] }],
    "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "npm exec -- claude-hook-post-tool" }] }, { "matcher": "Write", "hooks": [{ "type": "command", "command": "npm exec -- claude-hook-post-tool" }] }],
    "PreCompact": [{ "hooks": [{ "type": "command", "command": "npm exec -- claude-hook-pre-compact" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "npm exec -- claude-hook-session-end" }] }]
  }
}
```

**Note (v1.5.0+):** Full lifecycle coverage with 5 hooks. Uses `npm exec --` which finds local `node_modules/.bin` first.

### Installed Hooks (v1.5.0+)

| Hook | Command | Function |
|------|---------|----------|
| `SessionStart` | `claude-hook-session-start` | Auto-loads project context on session start |
| `UserPromptSubmit` | `claude-hook-user-prompt` | Auto-injects relevant memories + past reference search |
| `PostToolUse` | `claude-hook-post-tool` | Tracks active files (Edit, Write) + auto-injects error solutions (Bash) |
| `PreCompact` | `claude-hook-pre-compact` | Structured handover context before compression |
| `Stop` | `claude-hook-session-end` | Extracts commits, decisions, error-fix pairs from transcript |

### Manual Hook Management

```bash
# Check hook status
npx claude-session-hooks status

# Reinstall hooks
npx claude-session-hooks install

# Remove hooks
npx claude-session-hooks uninstall
```

### 3. Restart Claude Code

After installation, restart Claude Code to activate the hooks.

---

## Features

| Feature | Description |
|---------|-------------|
| 🤖 **Zero Manual Work** | Claude Hooks automate all context capture/load |
| 🎯 **Quality Memory Only** | **(v1.10.0)** Only decisions, learnings, errors — no file-change noise |
| 🧠 **Semantic Search** | multilingual-e5-small embedding (94+ languages, 384d) |
| 🌍 **Multilingual** | Korean/English/Japanese + cross-language search (EN→KR, KR→EN) |
| 🔗 **Git Integration** | Commit messages auto-extracted from transcripts |
| 🕸️ **Knowledge Graph** | Memory relations (solves, causes, extends...) |
| 📊 **Memory Classification** | 5 types: observation, decision, learning, error, pattern |
| ✅ **Integrated Verification** | One-click build/test/lint execution |
| 📋 **Task Management** | Priority-based task management |
| 🔧 **Auto Error→Solution** | **(v1.12.0)** Bash errors auto-detect → inject past solutions; session-end auto-records error-fix pairs |
| 💰 **Token Efficiency** | **(v1.11.0)** Removed loadContext from UserPromptSubmit (saves 24-60K tokens/session) |
| 📑 **Progressive Disclosure** | **(v1.11.0)** memory_search returns index first, memory_get for full content |
| ⏳ **Temporal Decay** | **(v1.11.0)** Memory scoring with type-specific half-lives for relevance |
| 📝 **Structured Handover** | **(v1.10.0)** PreCompact saves work summary, active files, pending actions |
| 🚪 **Smart Session End** | **(v1.10.0)** Extracts commits, decisions, error-fix pairs from transcript |
| 🗑️ **Auto Noise Cleanup** | **(v1.10.0)** Auto-deletes stale observation memories (3d+) |
| 🔍 **Past Reference Detection** | **(v1.8.0)** "저번에 X 어떻게 했어?" auto-searches DB |
| 📝 **User Directive Extraction** | **(v1.8.0)** Auto-extracts "always/never" rules from prompts |

---

## Claude Hooks - Auto Context System

### How It Works

**SessionStart Hook** (`npx claude-hook-session-start`):
- Auto-detects project: monorepo (`apps/project-name/`) or single project (`package.json` root folder name)
- Loads context from `.claude/sessions.db`
- Injects: Current state, **3 recent sessions** with commits/decisions, directives, pending tasks, filtered key memories
- Auto-cleans stale noise memories (3d+ auto-tracked, 14d+ auto-compact)

**UserPromptSubmit Hook** (`npx claude-hook-user-prompt`):
- Runs on every prompt submission
- **(v1.11.0)** No longer calls loadContext() — saves 24-60K tokens/session
- Injects relevant context (filtered: decisions, learnings, errors only)

**PostToolUse Hook** (`npx claude-hook-post-tool`):
- Tracks hot file paths and updates `active_context.recent_files`
- **(v1.12.0)** Auto-detects Bash errors → searches solutions DB → injects past solutions into context
- **No longer creates observation memories** (v1.10.0 — eliminates `[File Change]` noise)

**PreCompact Hook** (`npx claude-hook-pre-compact`):
- Builds structured handover context: work summary, active file, pending action, key facts, recent errors
- **No longer stores auto-compact memories** (v1.10.0)

**Stop Hook** (`npx claude-hook-session-end`):
- Extracts commit messages from JSONL transcript (`git commit -m` patterns)
- Extracts error-fix pairs (error → resolution within 3 messages)
- **(v1.12.0)** Auto-records error→fix pairs to solutions table for future reuse
- Extracts decisions ("because", "instead of", "chose" patterns)
- **(v1.11.0)** Single-pass transcript parsing (4 JSONL reads → 1)
- Stores structured metadata in `sessions.issues` column as JSON

### Example Output (Session Start)

```markdown
# my-app - Session Resumed

📍 **State**: Implementing signup form
🚧 **Blocker**: OAuth callback URL issue

## Recent Sessions
### 2026-02-28
**Work**: Completed OAuth integration
**Commits**: feat: add OAuth handler; fix: redirect config
**Decisions**: Use Server Actions over API routes
**Next**: Implement form validation

## Directives
- 🔴 Always use Zod for validation

## Pending Tasks
- 🔄 [P8] Implement form validation
- ⏳ [P5] Add error handling

## Key Memories
- 🎯 Decided on App Router, using Server Actions
- ⚠️ OAuth redirect_uri mismatch → check env file
```

### Hook Management

```bash
# Check status
npx claude-session-hooks status

# Reinstall
npx claude-session-hooks install

# Remove
npx claude-session-hooks uninstall

# Temporarily disable
export MCP_HOOKS_DISABLED=true
```

### Past Reference Detection (v1.8.0)

When you ask about past work, the `UserPromptSubmit` hook automatically searches the database:

```
You: "저번에 인앱결제 어떻게 했어?"
→ Hook detects "저번에" + extracts keyword "인앱결제"
→ Searches sessions, memories (FTS5), and solutions
→ Injects matching results into context automatically
```

**Supported patterns (Korean & English):**

| Pattern | Example |
|---------|---------|
| 저번에/전에/이전에 ... 어떻게 | "저번에 CORS 에러 어떻게 해결했지?" |
| ~했던/만들었던/해결했던 | "수정했던 로그인 로직" |
| 지난 세션/작업에서 | "지난 세션에서 결제 구현" |
| last time/before/previously | "How did we handle auth last time?" |
| did we/did I ... before | "Did we fix the database migration before?" |
| remember when/recall when | "Remember when we set up CI?" |

**Output example:**
```markdown
## Related Past Work (auto-detected from your question)

### Sessions
- [2/14] 카카오 로그인 앱키 수정, 인앱결제 IAP 플로우 수정

### Memories
- 🎯 [decision] 테스트: 인앱결제 상품 등록 완료

### Solutions
- **IAP_BILLING_ERROR**: StoreKit 2 migration으로 해결
```

### Why npm exec? (v1.4.3+)

Previous versions used absolute paths or `npx`:
```json
// v1.3.x - absolute paths (broke on multi-project)
"command": "node \"/path/to/project-a/node_modules/.../session-start.js\""

// v1.4.0-1.4.2 - npx (required global install or hit npm registry)
"command": "npx claude-hook-session-start"
```

Now we use `npm exec --`:
```json
"command": "npm exec -- claude-hook-session-start"
```

**`npm exec --` finds local `node_modules/.bin` first**, then falls back to global. Works with both local and global installation without hitting npm registry.

---

## Tools (v5 API) - 25 Focused Tools

### 1. Session Lifecycle (4) ⭐

```javascript
// Start of session - auto-loads context
session_start({ project: "my-app", compact: true })

// End of session - auto-saves context
session_end({
  project: "my-app",
  summary: "Completed auth flow",
  modifiedFiles: ["src/auth.ts", "src/login/page.tsx"]
})

// View session history
session_history({ project: "my-app", limit: 5 })

// Semantic search past sessions
search_sessions({ query: "auth work", project: "my-app" })
```

### 2. Project Management (4)

```javascript
// Get project status with task stats
project_status({ project: "my-app" })

// Initialize new project
project_init({ project: "my-app" })

// Analyze project tech stack
project_analyze({ project: "my-app" })

// List all projects
list_projects()
```

### 3. Task Management (4)

```javascript
// Add a task
task_add({ project: "my-app", title: "Implement signup", priority: 8 })

// Update task status
task_update({ taskId: 1, status: "done" })

// List tasks
task_list({ project: "my-app", status: "pending" })

// Suggest tasks from TODO comments
task_suggest({ project: "my-app" })
```

### 4. Solution Archive (3)

```javascript
// Record an error solution
solution_record({
  errorSignature: "TypeError: Cannot read property 'id'",
  solution: "Use optional chaining: user?.id"
})

// Find similar solutions (keyword or semantic)
solution_find({ query: "TypeError property", semantic: true })

// AI-powered solution suggestion
solution_suggest({ errorMessage: "Cannot read property 'email'" })
```

### 5. Verification (3)

```javascript
// Run build
verify_build({ project: "my-app" })

// Run tests
verify_test({ project: "my-app" })

// Run all (build + test + lint)
verify_all({ project: "my-app" })
```

### 6. Memory System (5)

```javascript
// Store a classified memory
memory_store({
  content: "State management with Riverpod makes testing easier",
  type: "learning",  // observation, decision, learning, error, pattern
  project: "my-app",
  tags: ["flutter", "state-management"],
  importance: 8,
  relatedTo: 23  // Connect to existing memory
})

// Search memories — returns index (id, type, tags, score) for token efficiency
memory_search({
  query: "state management test",
  type: "learning",
  semantic: true,  // Use embedding similarity
  limit: 10
})

// Get full memory content by ID (v1.11.0)
memory_get({ memoryId: 23 })

// Find related memories (graph + semantic)
memory_related({
  memoryId: 23,
  includeGraph: true,
  includeSemantic: true
})

// Get memory statistics
memory_stats({ project: "my-app" })
```

### 7. Knowledge Graph (2)

```javascript
// Connect two memories with a typed relation
graph_connect({
  sourceId: 23,
  targetId: 25,
  relation: "solves",  // related_to, causes, solves, depends_on, contradicts, extends, example_of
  strength: 0.9
})

// Explore knowledge graph
graph_explore({
  memoryId: 23,
  depth: 2,
  relation: "all",  // or specific relation type
  direction: "both"  // outgoing, incoming, both
})
```

## Memory Types

| Type | Description | Use Case |
|------|-------------|----------|
| `observation` | Patterns, structures found in codebase | "All screens are separated in features/ folder" |
| `decision` | Architecture, library choices | "Decided to use SharedPreferences for caching" |
| `learning` | New knowledge, best practices | "Riverpod is better for testing" |
| `error` | Occurred errors and solutions | "Provider.read() doesn't rebuild → use watch()" |
| `pattern` | Recurring code patterns, conventions | "Avoid late keyword abuse" |

## Relation Types

| Relation | Description | Example |
|----------|-------------|---------|
| `related_to` | General relation | A and B are related |
| `causes` | A causes B | Caching decision → folder structure change |
| `solves` | A solves B | Riverpod learning → Provider bug fix |
| `depends_on` | A depends on B | Folder structure → Caching decision |
| `contradicts` | A conflicts with B | Two design decisions conflict |
| `extends` | A extends B | late pattern → Extended to Riverpod learning |
| `example_of` | A is example of B | Specific code is example of pattern |

---

## Data Storage

SQLite database at `~/.claude/sessions.db`:

| Table | Purpose |
|-------|---------|
| `memories` | Classified memories (observation, decision, learning, error, pattern) |
| `memories_fts` | Full-text search index (FTS5) |
| `memory_relations` | Knowledge graph relations |
| `embeddings_v4` | Semantic search vectors (multilingual-e5-small, 384d) |
| `project_context` | Fixed project info (tech stack, decisions) |
| `active_context` | Current work state |
| `tasks` | Task backlog |
| `solutions` | Error solution archive |
| `sessions` | Session history |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_ROOT` | - | Workspace root path (required) |
| `MCP_HOOKS_DISABLED` | `false` | Disable Claude Hooks |
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |
| `LOG_FILE` | - | Optional file logging path |

---

## Development

```bash
# Clone
git clone https://github.com/leesgit/claude-session-continuity-mcp.git
cd claude-session-continuity-mcp

# Install
npm install

# Build
npm run build

# Test
npm test

# Test with coverage
npm run test:coverage
```

---

## Performance

| Metric | Value |
|--------|-------|
| Context load (cached) | **<5ms** |
| Memory search (FTS) | ~10ms |
| Semantic search | ~50ms |
| Build verification | Project-dependent |

---

## Roadmap

- [x] v2 API (15 focused tools)
- [x] v4 API (24 tools - memory + graph)
- [x] v5 Claude Hooks (auto-capture)
- [x] Knowledge Graph with typed relations
- [x] Memory classification (6 types)
- [x] Semantic search (embeddings)
- [x] Multilingual pattern detection (KO/EN/JA)
- [x] Git commit integration
- [x] 111 tests (6 test suites)
- [x] GitHub Actions CI/CD
- [x] Multilingual semantic search (v1.6.0 - multilingual-e5-small)
- [x] Cross-language search EN↔KR (v1.6.0)
- [x] Solution semantic search (v1.6.0)
- [x] Fix hooks settings file path (v1.6.1 - settings.json, not settings.local.json)
- [x] Auto-migrate legacy hooks (v1.6.1)
- [x] Fix PostToolUse matcher format to string (v1.6.3)
- [x] Fix README documentation for new hook format (v1.6.4)
- [x] Empty session skip and techStack save improvements (v1.7.1)
- [x] Past reference auto-detection in UserPromptSubmit hook (v1.8.0)
- [x] User directive extraction ("always/never" rules) (v1.8.0)
- [x] Memory quality overhaul — no more `[File Change]` noise (v1.10.0)
- [x] Structured handover context in PreCompact (v1.10.0)
- [x] Smart session-end: commit/decision/error-fix extraction from transcript (v1.10.0)
- [x] Auto noise cleanup (3d+ observations, 14d+ auto-compact) (v1.10.0)
- [x] 3 recent sessions display with structured metadata (v1.10.0)
- [x] Token efficiency — remove loadContext from UserPromptSubmit, saves 24-60K tokens/session (v1.11.0)
- [x] Single-pass transcript parsing, 4 JSONL reads → 1 (v1.11.0)
- [x] Temporal decay for memory scoring with type-specific half-lives (v1.11.0)
- [x] Progressive disclosure — memory_search returns index, memory_get for full content (v1.11.0)
- [x] Memory consolidation via Jaccard similarity (v1.11.0)
- [x] Auto error→solution pipeline — PostToolUse detects Bash errors, injects past solutions (v1.12.0)
- [x] SessionEnd auto-records error-fix pairs to solutions table (v1.12.0)
- [x] Cross-project solution search with current project prioritization (v1.12.0)
- [ ] sqlite-vec native vector search (v2 - when data > 1000 records)
- [ ] Web dashboard
- [ ] Cloud sync option

---

## Contributing

PRs welcome! Please:

1. Fork the repo
2. Create a feature branch
3. Add tests for new features
4. Ensure `npm test` passes
5. Submit PR

---

## License

[MIT](LICENSE) © Byeongchang Lee

---

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- [Xenova Transformers](https://github.com/xenova/transformers.js) for embeddings
