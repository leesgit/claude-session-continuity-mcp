# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-26

### Initial Release

Renamed from `project-manager-mcp` to `claude-session-continuity-mcp` for clarity.

### Added
- **v2 API**: 15 focused tools with clear purposes
  - `session_start` / `session_end` / `session_summary` - Automatic context capture
  - `context_get` / `context_update` - Project context management
  - `memory_store` / `memory_search` / `memory_delete` / `memory_stats` - Memory operations
  - `task_manage` - Unified task management
  - `verify` - Build/test/lint execution
  - `learn` / `recall_solution` - Auto-learning from errors
  - `projects` - Project listing
  - `rebuild_embeddings` - Semantic search maintenance

- **Zod schema validation** for all tool inputs
- **Structured logging** with sensitive data redaction
- **LRU query caching** for <5ms context reads
- **Semantic search** using all-MiniLM-L6-v2 embeddings
- **Web dashboard v2** with modern Tailwind-inspired design
- **111 unit tests** with Vitest
- **GitHub Actions CI/CD** for Node 18.x and 20.x

### Changed
- Consolidated 46 legacy tools into 15 v2 tools
- Improved error handling with typed errors
- Better TypeScript strict mode compliance

### Deprecated
- v1 tools still available but v2 is recommended
- Set `MCP_V2_ONLY=true` to use only v2 tools

## [0.x] - Pre-release

Development as `project-manager-mcp` with 46 tools.
