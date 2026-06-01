---
name: claude-extractor
description: Use when the user wants to extract, export, read, or tail a Claude Code session log as markdown — "dump my session", "tail this run", "export the conversation", "show me session abc123".
---

# claude-extractor

Extract Claude Code session logs (`~/.claude/projects/**/*.jsonl`) as readable markdown.

## Install / invoke

Run via bunx (no install needed):

```bash
bunx claude-extractor              # fuzzy picker (current dir's sessions)
bunx claude-extractor --all        # fuzzy picker across all projects
bunx claude-extractor <session-id> # dump a specific session as markdown
```

## Flags

| Flag | Effect |
|------|--------|
| `--list` | List recent sessions in current directory |
| `--list-all` | List all sessions across all projects |
| `--all` | Fuzzy picker across all projects |
| `--tail` | Stream a session live (auto-picks latest if no ID) |
| `--latest` | Dump the most recent session in current dir |
| `--dump-all <dir>` | Dump every session as markdown files into `<dir>` |
| `--render` | Render with glow + less pager (default: raw markdown) |
| `-h, --help` | Show usage |

## Output

Default output is **raw markdown** — pipe it, save it, paste it. Structured with:

- Session header (slug, timestamp, cwd, git branch, version)
- Stats line (duration, turns, token totals, tool-use counts)
- Per-turn user/assistant blocks with timestamps and token usage
- Tool calls (JSON input) and tool results (truncated at 3000 chars)
- Nested subagent transcripts (blockquoted by depth)

`--render` and `--tail` pipe through `glow` for pretty ANSI rendering (requires `glow` on PATH).

## Examples

```bash
bunx claude-extractor --tail                 # tail latest session live
bunx claude-extractor abc123 --render        # pretty-print one session in pager
bunx claude-extractor --dump-all ./sessions  # archive all sessions to a dir
```
