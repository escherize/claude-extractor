#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync, watchFile } from "fs";
import { join, basename, dirname } from "path";
import { spawnSync } from "child_process";
import search from "@inquirer/search";

const GLOW = spawnSync("which", ["glow"], { encoding: "utf8" }).status === 0 ? "glow" : null;

function compact(md: string): string {
  return md
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(^###[^\n]*)\n\n/gm, "$1\n");
}

function outputMd(md: string, mode: "raw" | "glow" | "pager" = "raw") {
  const src = compact(md);
  if (mode === "pager" && GLOW) {
    spawnSync("sh", ["-c", `${GLOW} - | less -R`], { input: src, stdio: ["pipe", "inherit", "inherit"] });
  } else if ((mode === "glow" || mode === "pager") && GLOW) {
    spawnSync(GLOW, ["-"], { input: src, stdio: ["pipe", "inherit", "inherit"] });
  } else {
    process.stdout.write(src);
  }
}

export { loadSubagents, firstPrompt };

const PROJECTS_DIR = join(process.env.HOME!, ".claude", "projects");

interface SessionRecord {
  type: string;
  isSidechain?: boolean;
  timestamp?: string;
  slug?: string;
  cwd?: string;
  sessionId?: string;
  permissionMode?: string;
  gitBranch?: string;
  version?: string;
  entrypoint?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  tool_name?: string;
}

interface SessionMeta {
  sessionId: string;
  filePath: string;
  cwd: string;
  slug: string;
  timestamp: string;
  firstMessage: string;
  sizeKb: number;
}

function getSessionMeta(filePath: string): SessionMeta | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const sizeKb = Math.round(raw.length / 1024);
    const lines = raw.split("\n").filter(Boolean);
    const records: SessionRecord[] = lines.map((l) => JSON.parse(l));

    const firstUser = records.find(
      (r) => r.type === "user" && !r.isSidechain && r.message?.role === "user"
    );
    if (!firstUser) return null;

    const content = firstUser.message?.content;
    let firstMessage = "";
    if (typeof content === "string") {
      firstMessage = content.trim().split("\n")[0].slice(0, 120);
    } else if (Array.isArray(content)) {
      const textBlock = content.find((b) => b.type === "text");
      firstMessage = (textBlock?.text ?? "").trim().split("\n")[0].slice(0, 120);
    }

    return {
      sessionId: firstUser.sessionId ?? basename(filePath, ".jsonl"),
      filePath,
      cwd: firstUser.cwd ?? "",
      slug: firstUser.slug ?? "",
      timestamp: firstUser.timestamp ?? "",
      firstMessage,
      sizeKb,
    };
  } catch {
    return null;
  }
}

function cwdToProjectDir(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

function listSessions(projectDirFilter?: string): SessionMeta[] {
  const sessions: SessionMeta[] = [];

  for (const projectDir of readdirSync(PROJECTS_DIR)) {
    if (projectDirFilter && projectDir !== projectDirFilter) continue;
    const projectPath = join(PROJECTS_DIR, projectDir);
    try {
      if (!statSync(projectPath).isDirectory()) continue;
    } catch {
      continue;
    }

    for (const file of readdirSync(projectPath)) {
      if (!file.endsWith(".jsonl") || file.startsWith("agent-")) continue;
      const meta = getSessionMeta(join(projectPath, file));
      if (meta) sessions.push(meta);
    }
  }

  sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return sessions;
}

function loadSubagents(filePath: string): Map<string, SessionRecord[]> {
  // returns map of agentId -> records, from <session-dir>/subagents/
  const sessionId = basename(filePath, ".jsonl");
  const subagentDir = join(dirname(filePath), sessionId, "subagents");
  const result = new Map<string, SessionRecord[]>();
  try {
    for (const f of readdirSync(subagentDir)) {
      if (!f.endsWith(".jsonl")) continue;
      const agentId = f.replace(/^agent-/, "").replace(/\.jsonl$/, "");
      const recs = readFileSync(join(subagentDir, f), "utf8")
        .split("\n").filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean) as SessionRecord[];
      result.set(agentId, recs);
    }
  } catch { /* no subagents dir */ }
  return result;
}

function firstPrompt(records: SessionRecord[]): string {
  const first = records.find((r) => r.type === "user" && r.message?.role === "user");
  const c = first?.message?.content;
  if (typeof c === "string") return c.slice(0, 200);
  if (Array.isArray(c)) return (c.find((b) => b.type === "text")?.text ?? "").slice(0, 200);
  return "";
}

function renderSubagent(records: SessionRecord[], depth: number): string {
  const prefix = "> ".repeat(depth);
  const parts: string[] = [];
  const mainRecs = records.filter((r) => r.type === "user" || r.type === "assistant");
  for (const r of mainRecs) {
    const content = r.message?.content;
    if (!content) continue;
    const time = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : "";
    if (r.type === "user") {
      const hasText = typeof content === "string" || (Array.isArray(content) && content.some((b) => b.type === "text"));
      if (!hasText) continue;
      parts.push(`${prefix}#### 👤 User (${time})`);
      const body = typeof content === "string" ? content : (content as ContentBlock[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      parts.push(body.split("\n").map((l) => `${prefix}${l}`).join("\n"));
    } else if (r.type === "assistant") {
      const u = r.message?.usage;
      const tokenInfo = u ? ` (in:${u.input_tokens} out:${u.output_tokens})` : "";
      parts.push(`${prefix}#### 🤖 Subagent (${time}${tokenInfo})`);
      const blocks = typeof content === "string" ? [content] : (content as ContentBlock[]).map((b) => fmtContentBlock(b));
      parts.push(blocks.join("\n").split("\n").map((l) => `${prefix}${l}`).join("\n"));
    }
    parts.push("");
  }
  return parts.join("\n");
}

function fmtContentBlock(block: ContentBlock, toolNames?: Map<string, string>, subagents?: Map<string, SessionRecord[]>): string {
  switch (block.type) {
    case "text":
      return block.text ?? "";
    case "tool_use": {
      const inputStr = JSON.stringify(block.input, null, 2);
      const shortId = block.id?.slice(-8) ?? "";
      if (block.name === "Agent" && subagents) {
        const prompt = (block.input as any)?.prompt ?? "";
        const match = [...subagents.entries()].find(([, recs]) =>
          firstPrompt(recs).slice(0, 100) === prompt.slice(0, 100)
        );
        const subType = (block.input as any)?.subagent_type ?? "agent";
        const header = `**Agent:** \`${subType}\` (${shortId})`;
        if (match) {
          return `${header}\n${renderSubagent(match[1], 1)}`;
        }
        return header;
      }
      return `**Tool call:** \`${block.name}\` (${shortId})\n\`\`\`json\n${inputStr}\n\`\`\``;
    }
    case "tool_result": {
      const c = block.content;
      let body = "";
      if (typeof c === "string") {
        body = c.length > 3000 ? c.slice(0, 3000) + "\n…(truncated)" : c;
      } else if (Array.isArray(c)) {
        body = c.map((b) => fmtContentBlock(b, toolNames, subagents)).join("\n");
      }
      const errorFlag = block.is_error ? " ⚠️ error" : "";
      const shortId = block.tool_use_id?.slice(-8) ?? "";
      const toolName = toolNames?.get(block.tool_use_id ?? "") ?? "";
      const isDiff = toolName === "Bash" && body.startsWith("diff --git");
      const lang = isDiff ? "diff" : "";
      return `**Tool result**${errorFlag} (${shortId}):\n\`\`\`${lang}\n${body}\n\`\`\``;
    }
    case "tool_reference":
      return `\`${block.tool_name}\``;
    default:
      return `[${block.type}]`;
  }
}

interface SessionStats {
  duration: string;
  totalIn: number;
  totalOut: number;
  totalCacheRead: number;
  toolCounts: Record<string, number>;
  turns: number;
}

function computeStats(records: SessionRecord[]): SessionStats {
  const main = records.filter((r) => !r.isSidechain);
  const timestamps = main.map((r) => r.timestamp).filter(Boolean) as string[];
  const first = timestamps[0];
  const last = timestamps[timestamps.length - 1];
  const durationMs = first && last ? Date.parse(last) - Date.parse(first) : 0;
  const mins = Math.floor(durationMs / 60000);
  const secs = Math.floor((durationMs % 60000) / 1000);
  const duration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  let totalIn = 0, totalOut = 0, totalCacheRead = 0;
  const toolCounts: Record<string, number> = {};
  let turns = 0;

  for (const r of main) {
    if (r.type === "assistant") {
      const u = r.message?.usage;
      if (u) {
        totalIn += u.input_tokens ?? 0;
        totalOut += u.output_tokens ?? 0;
        totalCacheRead += u.cache_read_input_tokens ?? 0;
      }
      const content = r.message?.content;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b.type === "tool_use" && b.name) {
            toolCounts[b.name] = (toolCounts[b.name] ?? 0) + 1;
          }
        }
      }
    }
    if (r.type === "user" && r.message?.role === "user") turns++;
  }

  return { duration, totalIn, totalOut, totalCacheRead, toolCounts, turns };
}

function fmtStats(stats: SessionStats): string {
  const toolSummary = Object.entries(stats.toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name}×${n}`)
    .join(" ");
  return [
    `**Duration:** ${stats.duration}`,
    `**Turns:** ${stats.turns}`,
    `**Tokens:** in ${stats.totalIn.toLocaleString()} out ${stats.totalOut.toLocaleString()}${stats.totalCacheRead ? ` cache_read ${stats.totalCacheRead.toLocaleString()}` : ""}`,
    toolSummary ? `**Tools:** ${toolSummary}` : "",
  ].filter(Boolean).join(" | ");
}

function sessionToMarkdown(filePath: string): string {
  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  const records: SessionRecord[] = lines.map((l) => JSON.parse(l));
  const mainRecords = records.filter(
    (r) => !r.isSidechain && (r.type === "user" || r.type === "assistant")
  );

  const meta = getSessionMeta(filePath);
  const stats = computeStats(records);
  const parts: string[] = [];

  // header
  const firstRecord = records.find((r) => !r.isSidechain && r.timestamp);
  const branch = firstRecord?.gitBranch ?? "";
  const entrypoint = firstRecord?.entrypoint ?? "";
  const version = firstRecord?.version ?? "";

  parts.push(`# ${meta?.slug ?? basename(filePath, ".jsonl")}`);
  parts.push(`**${meta?.timestamp ? new Date(meta.timestamp).toLocaleString() : "unknown"}** | \`${meta?.cwd?.replace(process.env.HOME!, "~") ?? ""}\` | \`${meta?.sessionId?.slice(0, 8) ?? ""}\``);
  if (branch || entrypoint || version) {
    parts.push(`**Branch:** \`${branch}\` | **Via:** ${entrypoint} | **v${version}**`);
  }
  parts.push(fmtStats(stats));
  parts.push("---");
  parts.push("");

  // build id->name map for linking tool_results back to their tool_use name
  const toolNames = new Map<string, string>();
  for (const r of records) {
    const content = r.message?.content;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === "tool_use" && b.id && b.name) toolNames.set(b.id, b.name);
      }
    }
  }
  const subagents = loadSubagents(filePath);

  for (const record of mainRecords) {
    const content = record.message?.content;
    if (!content) continue;
    const time = record.timestamp ? new Date(record.timestamp).toLocaleTimeString() : "";

    if (record.type === "user") {
      // skip tool-result-only records (no human text)
      const hasHumanText = typeof content === "string"
        || (Array.isArray(content) && content.some((b) => b.type === "text"));
      if (!hasHumanText) continue;
      const mode = record.permissionMode ? ` [${record.permissionMode}]` : "";
      parts.push(`### 👤 User (${time}${mode})`);
      if (typeof content === "string") {
        parts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) parts.push(fmtContentBlock(block, toolNames, subagents));
      }
      parts.push("");
    } else if (record.type === "assistant") {
      const u = record.message?.usage;
      const stop = record.message?.stop_reason ? ` stop:${record.message.stop_reason.replace(/_/g, "-")}` : "";
      const tokenInfo = u
        ? ` (in:${u.input_tokens} out:${u.output_tokens}${u.cache_read_input_tokens ? ` cr:${u.cache_read_input_tokens}` : ""}${u.cache_creation_input_tokens ? ` cw:${u.cache_creation_input_tokens}` : ""}${stop})`
        : "";
      parts.push(`### 🤖 Assistant (${time}${tokenInfo})`);
      if (typeof content === "string") {
        parts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) parts.push(fmtContentBlock(block, toolNames, subagents));
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

function sessionLabel(s: SessionMeta): string {
  const dt = s.timestamp ? new Date(s.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "unknown";
  const size = s.sizeKb >= 1024 ? `${(s.sizeKb / 1024).toFixed(1)}MB` : `${s.sizeKb}KB`;
  return `${dt} [${size}] ${s.firstMessage}`;
}

async function pickSession(sessions: SessionMeta[]): Promise<SessionMeta | null> {
  try {
    return await search<SessionMeta>({
      message: "Pick a session",
      source: async (input) => {
        const q = (input ?? "").toLowerCase();
        const filtered = q
          ? sessions.filter((s) => sessionLabel(s).toLowerCase().includes(q))
          : sessions.slice(0, 50);
        return filtered.map((s) => ({ name: sessionLabel(s), value: s }));
      },
    });
  } catch {
    // user pressed Ctrl-C - show hint using the top result
    const top = sessions[0];
    if (top) process.stderr.write(`\nuse: claude-extractor ${top.sessionId.slice(0, 8)}\n`);
    return null;
  }
}

function tailSession(filePath: string) {
  let offset = 0;

  function flush() {
    const raw = readFileSync(filePath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const records: SessionRecord[] = [];
    for (const line of lines.slice(offset)) {
      try { records.push(JSON.parse(line)); } catch { /* incomplete line */ }
    }
    offset = lines.length;

    for (const record of records) {
      if (record.isSidechain) continue;
      const time = record.timestamp ? new Date(record.timestamp).toLocaleTimeString() : "";
      if (record.type === "user" && record.message?.role === "user") {
        const content = record.message.content;
        const hasHumanText = typeof content === "string"
          || (Array.isArray(content) && content.some((b) => b.type === "text"));
        if (!hasHumanText) continue;
        const mode = record.permissionMode ? ` [${record.permissionMode}]` : "";
        const parts: string[] = [`### 👤 User (${time}${mode})`];
        if (typeof content === "string") parts.push(content);
        else if (Array.isArray(content)) for (const b of content) parts.push(fmtContentBlock(b));
        parts.push("");
        outputMd(parts.join("\n"), "glow");
      } else if (record.type === "assistant") {
        const u = record.message?.usage;
        const stop = record.message?.stop_reason ? ` stop:${record.message.stop_reason}` : "";
        const tokenInfo = u ? ` (in:${u.input_tokens} out:${u.output_tokens}${stop.replace(/_/g, "-")})` : "";
        const parts: string[] = [`### 🤖 Assistant (${time}${tokenInfo})`];
        const content = record.message?.content;
        if (typeof content === "string") parts.push(content);
        else if (Array.isArray(content)) for (const b of content) parts.push(fmtContentBlock(b));
        parts.push("");
        outputMd(parts.join("\n"), "glow");
      }
    }
  }

  flush();
  process.stderr.write(`\n[watching ${filePath}]\n`);
  watchFile(filePath, { interval: 500 }, flush);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`Usage: claude-extractor [session-id] [flags]

Flags:
  --list           List recent sessions in current directory
  --list-all       List all sessions across all projects
  --all            Fuzzy picker across all projects
  --tail           Stream a session live (auto-picks latest if no ID given)
  --latest         Dump the most recent session in current directory
  --dump-all <dir> Dump all sessions as markdown files into <dir>
  --render         Render with glow+less (default: raw markdown)
  -h, --help       Show this help

Examples:
  claude-extractor                        # fuzzy picker (current dir)
  claude-extractor --all                  # fuzzy picker (all projects)
  claude-extractor --tail                 # tail latest session
  claude-extractor abc123 --tail          # tail specific session
  claude-extractor --latest               # dump most recent session
  claude-extractor --dump-all ./sessions  # dump all sessions to dir
  claude-extractor abc123 --render        # render with glow pager
`);
    process.exit(0);
  }

  const dumpAllIdx = args.indexOf("--dump-all");
  const dumpAllDir = dumpAllIdx !== -1 ? args[dumpAllIdx + 1] : null;
  const sessionIdArg = args.find((a) => !a.startsWith("-") && a !== dumpAllDir);
  const listFlag = args.includes("--list");
  const listAllFlag = args.includes("--list-all");
  const allFlag = args.includes("--all");
  const tailFlag = args.includes("--tail");
  const renderFlag = args.includes("--render");
  const latestFlag = args.includes("--latest");

  const cwdProjectDir = cwdToProjectDir(process.cwd());
  const localSessions = listSessions(cwdProjectDir);

  if (listFlag) {
    for (const s of localSessions.slice(0, 20)) console.log(sessionLabel(s));
    return;
  }

  if (listAllFlag) {
    for (const s of listSessions()) console.log(sessionLabel(s));
    return;
  }

  if (dumpAllDir) {
    const { mkdirSync, writeFileSync } = await import("fs");
    mkdirSync(dumpAllDir, { recursive: true });
    const all = listSessions();
    for (const s of all) {
      const slug = s.slug || s.sessionId.slice(0, 8);
      const date = s.timestamp.slice(0, 10);
      const filename = `${date}-${slug}.md`.replace(/[^a-zA-Z0-9._-]/g, "-");
      const outPath = join(dumpAllDir, filename);
      try {
        writeFileSync(outPath, sessionToMarkdown(s.filePath));
        process.stderr.write(`wrote ${outPath}\n`);
      } catch (e) {
        process.stderr.write(`skip ${s.sessionId.slice(0, 8)}: ${e}\n`);
      }
    }
    return;
  }

  const sessions = allFlag ? listSessions() : (localSessions.length > 0 ? localSessions : listSessions());

  let session: SessionMeta | null = null;

  if (sessionIdArg) {
    session = sessions.find((s) => s.sessionId.startsWith(sessionIdArg)) ?? null;
    if (!session) {
      console.error(`No session found matching: ${sessionIdArg}`);
      process.exit(1);
    }
  } else if (latestFlag || (tailFlag && !sessionIdArg)) {
    session = sessions[0] ?? null;
    if (!session) { console.error("No sessions found"); process.exit(1); }
    process.stderr.write(`[session: ${session.slug || session.sessionId.slice(0, 8)}]\n`);
  } else {
    session = await pickSession(sessions);
    if (!session) process.exit(0);
  }

  if (tailFlag) {
    tailSession(session!.filePath);
  } else {
    outputMd(sessionToMarkdown(session!.filePath), renderFlag ? "pager" : "raw");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
