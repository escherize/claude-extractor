# claude-extractor

Browse, extract, search, and tail Claude Code sessions from the terminal.

## Requirements

- [Bun](https://bun.com) runtime
- [bat](https://github.com/sharkdp/bat) for syntax highlighting — **strongly recommended**

```bash
brew install bat
```

Without bat, output is plain unstyled markdown.

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

### Search session content

```bash
claude-extractor --search "pubkey"         # search current project sessions
claude-extractor --search "pubkey" --all   # search all projects
```

### Extract to markdown

```bash
claude-extractor              # pick and dump raw markdown to stdout
claude-extractor --latest     # dump most recent session
claude-extractor --render     # colorize with bat (auto-pager if long)
claude-extractor > out.md     # pipe to file
```

### Tail a session

```bash
claude-extractor --tail           # tail latest session (live)
claude-extractor abc123 --tail    # tail specific session
```

Streams new turns as they arrive. Pipe through bat for highlighting:

```bash
claude-extractor --tail | bat --language=markdown --paging=never
```

### Dump all sessions

```bash
claude-extractor --dump-all ./sessions   # write one .md file per session
```
