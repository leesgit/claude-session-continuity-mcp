# claude-session-continuity-mcp

> **Session Continuity for Claude Code** — Never re-explain your project again

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

```bash
# Session starts → Context auto-loads in <5ms
session_start({ project: "my-app" })

# → "my-app: Next.js 15 + TypeScript
#    Decisions: App Router, Server Actions, Zod validation
#    State: Auth complete, working on signup
#    Tasks: [P8] Implement signup form"
```

**Your project memory, instantly restored.**

---

## Quick Start

### Installation

```bash
npm install claude-session-continuity-mcp
```

### Claude Code Configuration

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

### That's it. Start using it.

---

## Features

| Feature | Description |
|---------|-------------|
| 🔄 **Auto Context Capture** | `session_start` / `session_end` automatically save and restore |
| ⚡ **<5ms Context Loading** | LRU caching for instant project recall |
| 🧠 **Semantic Search** | Find memories by meaning, not just keywords |
| ✅ **Integrated Verification** | Run build/test/lint with one command |
| 📝 **Architecture Decisions** | Track why you made technical choices |
| 📋 **Task Management** | Prioritized backlog that persists |
| 🎓 **Auto-Learning** | Remembers error fixes and patterns |

---

## Why Not Use...?

| Tool | What It Does | Why This Is Different |
|------|--------------|----------------------|
| **mcp-memory-service** | Generic AI memory (13+ tools) | **Claude Code optimized**, project-centric |
| **Official Memory** | Simple key-value store | **Automatic capture**, semantic search |
| **SESSION.md files** | Manual markdown files | **Zero manual work**, structured data |

---

## Tools (v2 API) - 15 Focused Tools

### Session Lifecycle ⭐

```javascript
// Start of session - auto-loads context
session_start({ project: "my-app", compact: true })

// End of session - auto-saves context
session_end({
  project: "my-app",
  currentState: "Completed auth flow",
  recentFiles: ["src/auth.ts", "src/login/page.tsx"]
})

// Get summary with token estimate
session_summary({ project: "my-app" })
```

### Context Management

```javascript
// Get project context
context_get({ project: "my-app" })

// Update context
context_update({
  project: "my-app",
  techStack: { framework: "Next.js 15", language: "TypeScript" },
  architectureDecisions: ["App Router", "Server Actions"]
})
```

### Memory Operations

```javascript
// Store a memory
memory_store({
  project: "my-app",
  type: "decision",
  content: "Using Zod for runtime validation",
  importance: 8,
  tags: ["validation", "architecture"]
})

// Search memories (FTS or semantic)
memory_search({
  query: "validation approach",
  semantic: true  // Uses embeddings
})
```

### Verification

```javascript
// Run build + test + lint
verify({ project: "my-app" })

// Run specific gates
verify({ project: "my-app", gates: ["build", "test"] })
```

### Auto-Learning

```javascript
// Learn from an error fix
learn({
  project: "my-app",
  type: "fix",
  content: "TypeError: Cannot read property 'id'",
  solution: "Use optional chaining: user?.id"
})

// Find similar solutions
recall_solution({ query: "TypeError property undefined" })
```

---

## v2 Mode (Recommended)

Use only the 15 focused v2 tools:

```json
{
  "env": {
    "WORKSPACE_ROOT": "/path/to/workspace",
    "MCP_V2_ONLY": "true"
  }
}
```

<details>
<summary>Legacy v1 tools (46 tools) - Click to expand</summary>

Still available for backwards compatibility:

`list_projects`, `detect_platform`, `get_tech_stack`, `get_project_stats`,
`get_session`, `update_session`, `save_session_history`, `get_session_history`,
`run_verification`, `search_similar_work`, `record_work_pattern`, `get_work_patterns`,
`store_memory`, `recall_memory`, `recall_by_timeframe`, `search_by_tag`,
`delete_memory`, `get_memory_stats`, `semantic_search`, `get_embedding_status`,
`rebuild_embeddings`, `create_relation`, `find_connected_memories`,
`collect_work_feedback`, `get_pending_feedbacks`, `resolve_feedback`,
`record_filter_pattern`, `get_filter_patterns`, `get_safe_output_guidelines`,
`auto_learn_decision`, `auto_learn_fix`, `auto_learn_pattern`, `auto_learn_dependency`,
`get_project_knowledge`, `get_similar_issues`, `get_project_context`,
`init_project_context`, `update_active_context`, `update_architecture_decision`,
`add_task`, `complete_task`, `update_task_status`, `get_pending_tasks`,
`record_solution`, `find_solution`, `get_continuity_stats`

</details>

---

## Data Storage

SQLite database at `~/.claude/sessions.db`:

| Table | Purpose |
|-------|---------|
| `memories` | Learnings, decisions, errors |
| `memories_fts` | Full-text search index |
| `embeddings` | Semantic search vectors |
| `project_context` | Fixed project info |
| `active_context` | Current work state |
| `tasks` | Task backlog |
| `resolved_issues` | Error solution archive |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKSPACE_ROOT` | - | Workspace root path (required) |
| `MCP_V2_ONLY` | `false` | Use only v2 tools |
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

# Run v2 dashboard
npm run dashboard:v2
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
- [x] Zod schema validation
- [x] 111 tests
- [x] GitHub Actions CI/CD
- [x] Semantic search
- [x] Auto-learning
- [ ] Test coverage 80%+
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
