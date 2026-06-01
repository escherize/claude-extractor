# claude-extractor

Browse, extract, and tail Claude Code sessions from the terminal.

## Requirements

- [Bun](https://bun.com) runtime
- [glow](https://github.com/charmbracelet/glow) for syntax highlighting — **strongly recommended**

```bash
brew install glow
```

Without glow, output is plain unstyled markdown.

## Install

```bash
npm install -g claude-extractor
```

## Usage

### Find a session

```bash
claude-extractor              # fuzzy picker (current project)
claude-extractor --all        # fuzzy picker (all projects)
claude-extractor --list       # list recent sessions in current project
claude-extractor --list-all   # list all sessions across all projects
claude-extractor abc123       # open session by ID prefix
```

### Extract to markdown

```bash
claude-extractor              # pick and dump to stdout
claude-extractor --latest     # dump most recent session
claude-extractor --render     # render with glow + pager
claude-extractor > out.md     # pipe to file
```

### Tail a session

```bash
claude-extractor --tail           # tail latest session (live)
claude-extractor abc123 --tail    # tail specific session
```

Streams new turns as they arrive. Useful for watching an active Claude Code session.

