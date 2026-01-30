# claude-session-continuity-mcp (v5)

> **Zero Re-explanation Session Continuity for Claude Code** — Automatic context capture + semantic search

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

## The Solution (v5)

v5 is **fully automatic**. Claude Hooks handle everything without manual calls:

```bash
# Session start → Auto-loads relevant context (Git-based semantic search)
# When asking → Auto-injects memories/solutions related to your query
# During conversation → Auto-captures important decisions/errors/learnings
# On commit → Commit messages automatically become memories
```

```
← Auto-output on session start:
# 🚀 my-app - Session Resumed

## Tech Stack
**framework**: Next.js, **language**: TypeScript

## Current State
📍 Implementing signup form
🚧 **Blocker**: OAuth callback URL issue

## 🧠 Relevant Memories (semantic: 0.89)
- 🎯 [decision] Decided on App Router, using Server Actions
- ⚠️ [error] OAuth redirect_uri mismatch → check env file
- 📚 [learning] Zod form validation gives automatic type inference
```

**Zero manual work. Context follows you.**

---

## Quick Start

### 1. MCP Server Installation

```bash
npm install claude-session-continuity-mcp
```

Add to `~/.claude.json` or `.mcp.json`:

```json
{
  "mcpServers": {
    "session-continuity": {
      "command": "npx",
      "args": ["claude-session-continuity-mcp"],
      "env": {
        "WORKSPACE_ROOT": "/path/to/your/workspace"
      }
    }
  }
}
```

### 2. Claude Hooks Installation (v5 Auto-Capture)

```bash
cd tools/project-manager-mcp/claude-hooks
python install_hooks.py
```

This registers automatic context hooks in `~/.claude/settings.local.json`.

**Installed Hooks:**

| Hook | File | Function |
|------|------|----------|
| `SessionStart` | `session_start.py` | Auto-loads relevant context via semantic search on session start |
| `PrePromptSubmit` | `pre_prompt_submit.py` | Auto-injects memories/solutions related to your query |
| `PostPromptSubmit` | `post_prompt_submit.py` | Auto-captures important info (decision, error, learning, etc.) |
| `SessionEnd` | `session_end.py` | Auto-saves sessions/memories based on Git commits |

### 3. That's it. Fully automatic.

---

## Features

| Feature | Description |
|---------|-------------|
| 🤖 **Zero Manual Work** | Claude Hooks automate all context capture/load |
| 🎯 **Query-Based Injection** | Selectively inject only relevant memories/solutions |
| 🧠 **Semantic Search** | MiniLM-L6-v2 embedding-based meaning search |
| 🌍 **Multilingual Patterns** | Auto-detect Korean/English/Japanese patterns |
| 🔗 **Git Integration** | Commit messages auto-memorized |
| 🕸️ **Knowledge Graph** | Memory relations (solves, causes, extends...) |
| 📊 **Memory Classification** | 6 types: observation, decision, learning, error, pattern, code |
| ✅ **Integrated Verification** | One-click build/test/lint execution |
| 📋 **Task Management** | Priority-based task management |
| 🔧 **Solution Archive** | Auto-search error solutions |

---

## Why Not Use...?

| Tool | What It Does | Why This Is Different |
|------|--------------|----------------------|
| **mcp-memory-service** | Generic AI memory | **Git integration**, task/solution unified, multilingual |
| **Official Memory** | Simple key-value store | **Auto-capture**, semantic search, knowledge graph |
| **SESSION.md files** | Manual markdown files | **Fully automatic**, Hook-based |

### vs mcp-memory-service (Detailed Comparison)

| Feature | This MCP | mcp-memory-service |
|---------|----------|-------------------|
| Auto-capture | ✅ Hook-based | ✅ Hook-based |
| Semantic search | ✅ MiniLM-L6-v2 | ✅ MiniLM-L6-v2 |
| **Git commit integration** | ✅ Commit → Memory | ❌ |
| **Task management** | ✅ Built-in | ❌ |
| **Solution archive** | ✅ Error solution DB | ❌ |
| **Build/Test** | ✅ verify_all | ❌ |
| **Multilingual patterns** | ✅ KO/EN/JA | ❌ English-centric |
| Cloud sync | ❌ | ✅ Cloudflare D1 |
| Web dashboard | ❌ | ✅ Port 8000 |

---

## Claude Hooks (v5) - Auto-Capture System

### Directory Structure

```
claude-hooks/
├── session_start.py      # Session start - Semantic context load
├── pre_prompt_submit.py  # Pre-prompt - Query-based memory injection
├── post_prompt_submit.py # Post-prompt - Auto memory capture
├── session_end.py        # Session end - Git-based save
└── install_hooks.py      # Install script
```

### session_start.py - Semantic Context Load

Auto-loads relevant memories via **4-phase multi-stage search** on session start:

```
Phase 0: Semantic search (embedding similarity based on Git keywords)
Phase 1: Git commit keyword FTS search
Phase 2: Recent 7-day memories
Phase 3: Important tags (decision, error)
Phase 4: Fallback (general context)
```

### pre_prompt_submit.py - Query-Based Injection

Auto-injects **only memories/solutions related** to user's query:

```python
# Example: When asking "How to fix OAuth error"
→ Search OAuth-related memories (FTS + keyword)
→ Search error-type solutions
→ Auto-add to context
```

### post_prompt_submit.py - Auto Memory Capture

Auto-detects and saves **6 types** from conversation content:

| Type | Detection Patterns (Multilingual) | Example |
|------|-----------------------------------|---------|
| `decision` | "decided", "chose", "결정", "選択" | Architecture decisions |
| `error` | "fixed", "solved", "에러", "解決" | Bug fixes |
| `learning` | "learned", "discovered", "배웠", "学んだ" | New knowledge |
| `implementation` | "implemented", "completed", "구현", "実装" | Feature implementation |
| `important` | "critical", "must", "중요", "重要" | Important notes |
| `code` | Code blocks (100+ chars) | Code snippets |

**User Overrides:**
- `#remember` / `#기억` / `#覚える` - Force save
- `#skip` / `#무시` / `#スキップ` - Don't save

### session_end.py - Git-Based Save

Saves sessions/memories **only when commits exist** (noise prevention):

```
1. New commit detected → Save session + memory
2. Only uncommitted changes → Update active_context only
3. Track commit hash → Prevent duplicate saves
```

### Install/Remove

```bash
# Install
cd claude-hooks && python install_hooks.py

# Remove
python install_hooks.py --remove

# Check status
python install_hooks.py --status

# Temporarily disable
export MCP_HOOKS_DISABLED=true
```

---

## Tools (v5 API) - 24 Focused Tools

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

// Find similar solutions
solution_find({ query: "TypeError property" })

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

### 6. Memory System (4)

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

// Search memories (keyword or semantic)
memory_search({
  query: "state management test",
  type: "learning",
  semantic: true,  // Use embedding similarity
  limit: 10
})

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
| `embeddings_v4` | Semantic search vectors (MiniLM-L6-v2) |
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
- [x] 111 tests
- [x] GitHub Actions CI/CD
- [ ] Test coverage 80%+
- [ ] Web dashboard
- [ ] Docker image
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
- Inspired by [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service)
