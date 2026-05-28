#!/usr/bin/env bun
import { readdirSync, readFileSync, statSync, watchFile } from "fs";
import { join, basename } from "path";
import search from "@inquirer/search";
import chalk from "chalk";

function render(md: string): string {
  return md
    .replace(/^### (.+)$/gm, (_, t) => chalk.bold.cyan(`### ${t}`))
    .replace(/^## (.+)$/gm, (_, t) => chalk.bold.yellow(`## ${t}`))
    .replace(/^# (.+)$/gm, (_, t) => chalk.bold.white.underline(t))
    .replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t))
    .replace(/`([^`\n]+)`/g, (_, t) => chalk.green(t))
    .replace(/^(```[\s\S]*?```)/gm, (block) => chalk.gray(block))
    .replace(/_([^_]+)_/g, (_, t) => chalk.dim(t));
}

const PROJECTS_DIR = join(process.env.HOME!, ".claude", "projects");

interface SessionRecord {
  type: string;
  isSidechain?: boolean;
  timestamp?: string;
  slug?: string;
  cwd?: string;
  sessionId?: string;
  message?: {
    role?: string;
    content?: string | ContentBlock[];
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
  input?: unknown;
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
}

function getSessionMeta(filePath: string): SessionMeta | null {
  try {
    const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
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
    };
  } catch {
    return null;
  }
}

function listSessions(): SessionMeta[] {
  const sessions: SessionMeta[] = [];

  for (const projectDir of readdirSync(PROJECTS_DIR)) {
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

function fmtContentBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text ?? "";
    case "tool_use": {
      const inputStr = JSON.stringify(block.input, null, 2);
      return `**Tool call:** \`${block.name}\`\n\`\`\`json\n${inputStr}\n\`\`\``;
    }
    case "tool_result": {
      const c = block.content;
      let body = "";
      if (typeof c === "string") {
        body = c.length > 3000 ? c.slice(0, 3000) + "\n…(truncated)" : c;
      } else if (Array.isArray(c)) {
        body = c.map((b) => fmtContentBlock(b)).join("\n");
      }
      const errorFlag = block.is_error ? " ⚠️ error" : "";
      return `**Tool result**${errorFlag}:\n\`\`\`\n${body}\n\`\`\``;
    }
    case "tool_reference":
      return `\`${block.tool_name}\``;
    default:
      return `[${block.type}]`;
  }
}

function sessionToMarkdown(filePath: string): string {
  const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  const records: SessionRecord[] = lines.map((l) => JSON.parse(l));

  const mainRecords = records.filter(
    (r) => !r.isSidechain && (r.type === "user" || r.type === "assistant")
  );

  const meta = getSessionMeta(filePath);
  const parts: string[] = [];

  const ts = meta?.timestamp ? new Date(meta.timestamp).toLocaleString() : "unknown";
  parts.push(`# ${meta?.slug ?? basename(filePath, ".jsonl")}`);
  parts.push(`**${ts}** | \`${meta?.cwd?.replace(process.env.HOME!, "~") ?? ""}\` | \`${meta?.sessionId?.slice(0, 8) ?? ""}\``);
  parts.push("---");
  parts.push("");

  for (const record of mainRecords) {
    const content = record.message?.content;
    if (!content) continue;

    const time = record.timestamp ? new Date(record.timestamp).toLocaleTimeString() : "";

    if (record.type === "user") {
      parts.push(`### 👤 User _${time}_`);
      if (typeof content === "string") {
        parts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) parts.push(fmtContentBlock(block));
      }
      parts.push("");
    } else if (record.type === "assistant") {
      const u = record.message?.usage;
      const tokenInfo = u
        ? ` _(in: ${u.input_tokens} out: ${u.output_tokens}${u.cache_read_input_tokens ? ` cache_read: ${u.cache_read_input_tokens}` : ""})_`
        : "";
      parts.push(`### 🤖 Assistant _${time}_${tokenInfo}`);
      if (typeof content === "string") {
        parts.push(content);
      } else if (Array.isArray(content)) {
        for (const block of content) parts.push(fmtContentBlock(block));
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

function sessionLabel(s: SessionMeta): string {
  const date = s.timestamp.slice(0, 10);
  const cwd = s.cwd.replace(process.env.HOME!, "~");
  return `${date} | ${cwd} | ${s.firstMessage}`;
}

async function pickSession(sessions: SessionMeta[]): Promise<SessionMeta | null> {
  const result = await search<SessionMeta>({
    message: "Pick a session",
    source: async (input) => {
      const q = (input ?? "").toLowerCase();
      const filtered = q
        ? sessions.filter((s) => sessionLabel(s).toLowerCase().includes(q))
        : sessions.slice(0, 50);
      return filtered.map((s) => ({ name: sessionLabel(s), value: s }));
    },
  });
  return result ?? null;
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
        const parts: string[] = [`### 👤 User _${time}_`];
        const content = record.message.content;
        if (typeof content === "string") parts.push(content);
        else if (Array.isArray(content)) for (const b of content) parts.push(fmtContentBlock(b));
        parts.push("");
        process.stdout.write(render(parts.join("\n")));
      } else if (record.type === "assistant") {
        const u = record.message?.usage;
        const tokenInfo = u ? ` _(in: ${u.input_tokens} out: ${u.output_tokens})_` : "";
        const parts: string[] = [`### 🤖 Assistant _${time}_${tokenInfo}`];
        const content = record.message?.content;
        if (typeof content === "string") parts.push(content);
        else if (Array.isArray(content)) for (const b of content) parts.push(fmtContentBlock(b));
        parts.push("");
        process.stdout.write(render(parts.join("\n")));
      }
    }
  }

  flush();
  process.stderr.write(`\n[watching ${filePath}]\n`);
  watchFile(filePath, { interval: 500 }, flush);
}

async function main() {
  const args = process.argv.slice(2);
  const sessionIdArg = args.find((a) => !a.startsWith("-"));
  const listFlag = args.includes("--list");
  const tailFlag = args.includes("--tail");

  const sessions = listSessions();

  if (listFlag) {
    for (const s of sessions) {
      console.log(sessionLabel(s));
    }
    return;
  }

  let session: SessionMeta | null = null;

  if (sessionIdArg) {
    session = sessions.find((s) => s.sessionId.startsWith(sessionIdArg)) ?? null;
    if (!session) {
      console.error(`No session found matching: ${sessionIdArg}`);
      process.exit(1);
    }
  } else {
    session = await pickSession(sessions);
    if (!session) process.exit(0);
  }

  if (tailFlag) {
    tailSession(session!.filePath);
  } else {
    const md = sessionToMarkdown(session!.filePath);
    process.stdout.write(render(md));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
