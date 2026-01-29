# claude-session-continuity-mcp (v4)

> **Session Continuity + Knowledge Graph for Claude Code** — Never re-explain your project again

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

## The Solution (v4)

```bash
# Session starts → Context auto-loads in <5ms
session_start({ project: "my-app" })

# → "my-app: Next.js 15 + TypeScript
#    Decisions: App Router, Server Actions, Zod validation
#    State: Auth complete, working on signup
#    Tasks: [P8] Implement signup form"

# 과거 에러와 해결책을 시맨틱 검색
memory_search({ query: "Provider rebuild 안됨", semantic: true })

# 지식 그래프로 관련 메모리 탐색
graph_explore({ memoryId: 23, depth: 2 })
```

**Your project memory + knowledge graph, instantly restored.**

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
| 🕸️ **Knowledge Graph** | Connect memories with typed relations (solves, causes, extends...) |
| 📊 **Memory Classification** | 5 types: observation, decision, learning, error, pattern |
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

## Tools (v4 API) - 24 Focused Tools

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
search_sessions({ query: "인증 작업", project: "my-app" })
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

### 6. Memory System (4) 🆕

```javascript
// Store a classified memory
memory_store({
  content: "Riverpod으로 상태관리하면 테스트가 쉬워짐",
  type: "learning",  // observation, decision, learning, error, pattern
  project: "my-app",
  tags: ["flutter", "state-management"],
  importance: 8,
  relatedTo: 23  // Connect to existing memory
})

// Search memories (keyword or semantic)
memory_search({
  query: "상태관리 테스트",
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

### 7. Knowledge Graph (2) 🆕

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
| `observation` | 코드베이스에서 발견한 패턴, 구조 | "모든 화면은 features/ 폴더에 분리됨" |
| `decision` | 아키텍처, 라이브러리 선택 | "캐싱을 위해 SharedPreferences 사용 결정" |
| `learning` | 새로 알게 된 지식, 베스트 프랙티스 | "Riverpod이 테스트에 더 유리함" |
| `error` | 발생한 에러와 해결 방법 | "Provider.read()로 rebuild 안됨 → watch()로 해결" |
| `pattern` | 반복되는 코드 패턴, 컨벤션 | "late 키워드 남용 금지" |

## Relation Types

| Relation | Description | Example |
|----------|-------------|---------|
| `related_to` | 일반적인 관계 | A와 B가 관련됨 |
| `causes` | A가 B를 발생시킴 | 캐싱 결정 → 폴더 구조 변경 |
| `solves` | A가 B를 해결함 | Riverpod 학습 → Provider 버그 해결 |
| `depends_on` | A가 B에 의존함 | 폴더 구조 → 캐싱 결정 |
| `contradicts` | A와 B가 충돌함 | 두 설계 결정이 상충 |
| `extends` | A가 B를 확장함 | late 패턴 → Riverpod 학습 확장 |
| `example_of` | A가 B의 예시임 | 특정 코드가 패턴의 예시 |

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
- [x] v4 API (24 tools - memory + graph)
- [x] Knowledge Graph with typed relations
- [x] Memory classification (5 types)
- [x] Semantic search (embeddings)
- [x] Zod schema validation
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
