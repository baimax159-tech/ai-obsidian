#!/usr/bin/env node
/** Read Claude Code and Codex transcripts and emit evidence-oriented JSON. */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCHEMA_VERSION = "session-scan/v2";
export const REDACTED = "<redacted>";
export const SENSITIVE_KEY = /(?:token|secret|password|authorization|cookie|credential|api[_-]?key|private[_-]?key)/i;
export const FIXED_OFFSET = /^([+-])(\d{2}):(\d{2})$/;
export const TEXT_REDACTIONS = [
  [/(\bauthorization\s*:\s*)[^\r\n]+/gim, "$1<redacted>"],
  [/(\bcookie\s*:\s*)[^\r\n]+/gim, "$1<redacted>"],
  [/(bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1<redacted>"],
  [
    /((?:["']?)(?:token|secret|password|authorization|cookie|credential|api[_-]?key|private[_-]?key)(?:["']?)\s*[:=]\s*)(["'])(.*?)\2/gi,
    "$1$2<redacted>$2",
  ],
  [
    /(\b(?:token|secret|password|authorization|cookie|credential|api[_-]?key|private[_-]?key)\b\s*[:=]\s*)([^\s,;]+)/gi,
    "$1<redacted>",
  ],
  [
    /(--(?:token|secret|password|authorization|cookie|credential|api[_-]?key|private[_-]?key)(?:=|\s+))(["'])(.*?)\2/gi,
    "$1$2<redacted>$2",
  ],
  [
    /(--(?:token|secret|password|authorization|cookie|credential|api[_-]?key|private[_-]?key)(?:=|\s+))([^\s]+)/gi,
    "$1<redacted>",
  ],
  [
    /([?&](?:token|secret|password|authorization|cookie|credential|api[_-]?key|private[_-]?key)=)([^&#\s]+)/gi,
    "$1<redacted>",
  ],
  [/(https?:\/\/[^:/\s]+:)([^@/\s]+)(@)/gi, "$1<redacted>$3"],
];
export const PRIVATE_KEY_BLOCK = /-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----/gs;
export const NOISE_BLOCKS = [
  "system-reminder",
  "local-command-caveat",
  "local-command-stdout",
  "task-notification",
];
export const NOISE_PREFIXES = [
  "Base directory for this skill:",
  "Skill /",
  "[Request interrupted by user",
];
export const USEFUL_INPUT_KEYS = new Set([
  "file_path",
  "path",
  "command",
  "pattern",
  "query",
  "description",
  "cwd",
  "workdir",
  "taskId",
  "task_id",
  "status",
  "skill",
  "args",
  "questions",
  "subagent_type",
  "run_in_background",
  "output_mode",
  "glob",
]);
export const TEST_PATTERNS = [
  "go test",
  "pytest",
  "python -m unittest",
  "npm test",
  "npm run test",
  "pnpm test",
  "yarn test",
  "cargo test",
  "mvn test",
  "gradle test",
  "golangci-lint",
  "go build",
];

const HELP = `usage: scan_sessions.mjs [-h] --date DATE [--timezone TIMEZONE_NAME]
                         [--claude-projects-root ROOT | --claude-session-root ROOT]
                         [--codex-sessions-root ROOT]
                         [--output OUTPUT] [--force]
                         [--max-text-chars MAX_TEXT_CHARS]

Scan Claude Code and Codex JSONL transcripts for work evidence.

options:
  -h, --help            show this help message and exit
  --date DATE           Local date: YYYY-MM-DD
  --timezone TIMEZONE_NAME
                        IANA timezone or fixed offset such as +08:00; defaults
                        to system local timezone
  --claude-projects-root ROOT, --projects-root ROOT
                        Claude projects root; repeatable
  --claude-session-root ROOT, --session-root ROOT
                        One Claude project transcript directory; repeatable
  --codex-sessions-root ROOT
                        Codex sessions root; repeatable and recursively scanned
  --output OUTPUT       Optional new UTF-8 JSON output path
  --force               Allow replacing an existing output file
  --max-text-chars MAX_TEXT_CHARS
                        Maximum characters retained per free-text evidence
                        field
`;

export function buildParser() {
  return {
    description: "Scan Claude Code and Codex JSONL transcripts for work evidence.",
    help: HELP,
    parseArgs,
  };
}

export function parseDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError("date must use YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new TypeError("date must use YYYY-MM-DD");
  }
  return value;
}

function systemTimezone() {
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const resolved = new Intl.DateTimeFormat(undefined, { timeZone: name, timeZoneName: "long" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value || name;
  return { name, resolved };
}

function validateIanaTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(
        `IANA timezone ${JSON.stringify(value)} is unavailable; install tzdata or use a fixed offset such as +08:00`,
      );
    }
    throw error;
  }
}

export function resolveTimezone(value) {
  if (value == null) {
    const local = systemTimezone();
    return [{ kind: "iana", name: local.name }, local.resolved];
  }

  const match = FIXED_OFFSET.exec(value);
  if (match) {
    const [, sign, hoursText, minutesText] = match;
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    if (hours > 23 || minutes > 59) {
      throw new Error(`invalid timezone offset: ${value}`);
    }
    const direction = sign === "-" ? -1 : 1;
    return [{ kind: "fixed", name: value, offsetMinutes: direction * (hours * 60 + minutes) }, value];
  }

  validateIanaTimezone(value);
  return [{ kind: "iana", name: value }, value];
}

function expandUser(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function normalizePath(value) {
  const expanded = expandUser(String(value));
  let resolved = path.resolve(expanded);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return resolved.replaceAll("\\", "/");
}

function normcase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function sortedDirectoryEntries(root) {
  return fs.readdirSync(root, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
}

function addTranscript(discovered, transcript, descriptor) {
  const normalized = normalizePath(transcript);
  discovered.set(normcase(normalized), {
    host: descriptor.host,
    path: normalized,
    session_root: normalizePath(descriptor.sessionRoot),
    project_slug: descriptor.projectSlug ?? null,
    source_kind: descriptor.sourceKind,
  });
}

function discoverCodexFiles(discovered, root, sessionRoot) {
  for (const entry of sortedDirectoryEntries(root)) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      discoverCodexFiles(discovered, candidate, sessionRoot);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      addTranscript(discovered, candidate, {
        host: "codex",
        sessionRoot,
        sourceKind: "codex-sessions-root",
      });
    }
  }
}

export function discoverTranscripts(projectsRoots, sessionRoots, codexSessionsRoots) {
  const discovered = new Map();
  const noExplicitRoots = (!projectsRoots || projectsRoots.length === 0)
    && (!sessionRoots || sessionRoots.length === 0)
    && (!codexSessionsRoots || codexSessionsRoots.length === 0);
  if (noExplicitRoots) {
    const defaultClaudeRoot = path.join(os.homedir(), ".claude", "projects");
    const defaultCodexRoot = path.join(os.homedir(), ".codex", "sessions");
    projectsRoots = fs.existsSync(defaultClaudeRoot) ? [defaultClaudeRoot] : [];
    codexSessionsRoots = fs.existsSync(defaultCodexRoot) ? [defaultCodexRoot] : [];
  }

  const claudeRoots = [];
  for (const rootValue of projectsRoots || []) {
    const root = expandUser(String(rootValue));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Claude projects root does not exist: ${rootValue}`);
    }
    for (const child of sortedDirectoryEntries(root)) {
      if (child.isDirectory()) claudeRoots.push([path.join(root, child.name), "projects-root"]);
    }
  }
  for (const rootValue of sessionRoots || []) {
    const root = expandUser(String(rootValue));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Claude session root does not exist: ${rootValue}`);
    }
    claudeRoots.push([root, "session-root"]);
  }

  for (const [root, sourceKind] of claudeRoots) {
    for (const entry of sortedDirectoryEntries(root)) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      addTranscript(discovered, path.join(root, entry.name), {
        host: "claude",
        sessionRoot: root,
        projectSlug: path.basename(root),
        sourceKind,
      });
    }
  }

  for (const rootValue of codexSessionsRoots || []) {
    const root = expandUser(String(rootValue));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`Codex sessions root does not exist: ${rootValue}`);
    }
    discoverCodexFiles(discovered, root, root);
  }

  return [...discovered.keys()].sort().map((key) => discovered.get(key));
}

export function parseTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  let candidate = value;
  if (/Z$/i.test(candidate)) candidate = `${candidate.slice(0, -1)}+00:00`;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (!hasTimezone) candidate = `${candidate}Z`;
  const milliseconds = Date.parse(candidate);
  if (Number.isNaN(milliseconds)) return null;
  const parsed = new Date(milliseconds);
  const fraction = /\.([0-9]+)/.exec(value)?.[1];
  const microsecond = fraction ? Number(fraction.slice(0, 6).padEnd(6, "0")) : 0;
  Object.defineProperty(parsed, "microsecond", { value: microsecond });
  return parsed;
}

function canonicalNumber(value) {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (Object.is(value, -0)) return "-0.0";
  if (Number.isInteger(value)) return String(value);
  let rendered = String(value);
  if (/e/i.test(rendered)) {
    rendered = rendered.replace(/e([+-]?)(\d+)$/i, (_, sign, digits) => `e${sign || "+"}${digits.padStart(2, "0")}`);
  }
  return rendered;
}

function canonicalStringify(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(", ")}]`;
  if (isMapping(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${canonicalStringify(value[key])}`).join(", ")}}`;
  }
  return JSON.stringify(String(value));
}

export function jsonSha256(value) {
  return crypto.createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

export function truncate(text, limit) {
  const chars = [...text];
  if (chars.length <= limit) {
    return { text, truncated: false, original_chars: chars.length };
  }
  return {
    text: chars.slice(0, limit).join("") + "…",
    truncated: true,
    original_chars: chars.length,
  };
}

export function sanitizeText(value) {
  let redacted = value.replace(PRIVATE_KEY_BLOCK, "<redacted-private-key>");
  for (const [pattern, replacement] of TEXT_REDACTIONS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

function isMapping(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function sanitize(value, depth = 0) {
  if (depth > 8) return "<max-depth>";
  if (isMapping(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const keyText = String(key);
      result[keyText] = SENSITIVE_KEY.test(keyText) ? REDACTED : sanitize(item, depth + 1);
    }
    return result;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "string") return sanitizeText(value);
  return value;
}

export function sanitizeToolInput(value) {
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const keyText = String(key);
    if (USEFUL_INPUT_KEYS.has(keyText) || SENSITIVE_KEY.test(keyText)) {
      result[keyText] = SENSITIVE_KEY.test(keyText) ? REDACTED : sanitize(item, 1);
    }
  }
  return result;
}

export function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => isMapping(block) && block.type === "text")
      .map((block) => block.text || "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function codexText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isMapping)
    .map((block) => typeof block.text === "string" ? block.text : "")
    .filter(Boolean)
    .join("\n");
}

function parseJsonObject(value) {
  if (isMapping(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isMapping(parsed) ? parsed : { value: parsed };
  } catch {
    return { raw: value };
  }
}

function codexOutcomeStatus(value) {
  const status = String(value || "").toLowerCase();
  if (new Set(["success", "succeeded", "completed", "ok"]).has(status)) return "success";
  if (new Set(["failed", "failure", "error", "denied"]).has(status)) return "error";
  return "unknown";
}

function codexFilenameSessionId(sourcePath) {
  const stem = path.basename(sourcePath, ".jsonl");
  return /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(stem)?.[1] ?? null;
}

function codexMetadata(rawEnvelopes, sourcePath) {
  const sessionIds = [];
  const cwdValues = [];
  const branchValues = [];
  for (const envelope of rawEnvelopes) {
    if (envelope?.type !== "session_meta" || !isMapping(envelope.payload)) continue;
    const payload = envelope.payload;
    const sessionId = payload.session_id || payload.id;
    if (typeof sessionId === "string" && sessionId) sessionIds.push(sessionId);
    if (typeof payload.cwd === "string" && payload.cwd) cwdValues.push(payload.cwd);
    if (typeof payload.git?.branch === "string" && payload.git.branch) branchValues.push(payload.git.branch);
  }
  return {
    sessionId: counterMostCommon(sessionIds) || codexFilenameSessionId(sourcePath),
    cwd: counterMostCommon(cwdValues),
    gitBranch: counterMostCommon(branchValues),
  };
}

function codexResponseMessages(rawEnvelopes) {
  const messages = [];
  rawEnvelopes.forEach((envelope, index) => {
    const payload = envelope?.payload;
    if (envelope?.type !== "response_item" || payload?.type !== "message") return;
    if (!new Set(["user", "assistant"]).has(payload.role)) return;
    const text = codexText(payload.content);
    if (text) messages.push({ index, role: payload.role, text });
  });
  return messages;
}

function hasNearbyCodexMessage(messages, index, role, text) {
  return messages.some((message) => message.role === role && message.text === text && Math.abs(message.index - index) <= 3);
}

function normalizeCodexEnvelope(envelope, sequence, metadata, responseMessages) {
  const payload = isMapping(envelope.payload) ? envelope.payload : {};
  const common = {
    sessionId: metadata.sessionId,
    cwd: metadata.cwd,
    gitBranch: metadata.gitBranch,
  };

  if (envelope.type === "session_meta") return { type: "codex_metadata", ...common };

  if (envelope.type === "response_item" && payload.type === "message") {
    if (payload.role === "developer") return { type: "codex_metadata", ...common };
    if (payload.role === "user") {
      return {
        type: "user",
        origin: { kind: "human" },
        uuid: payload.id || `codex-user-${sequence}`,
        message: { role: "user", content: codexText(payload.content) },
        ...common,
      };
    }
    if (payload.role === "assistant") {
      return {
        type: "assistant",
        message: {
          id: payload.id || `codex-assistant-${sequence}`,
          role: "assistant",
          content: codexText(payload.content) ? [{ type: "text", text: codexText(payload.content) }] : [],
        },
        ...common,
      };
    }
  }

  if (envelope.type === "event_msg" && new Set(["user_message", "agent_message"]).has(payload.type)) {
    const role = payload.type === "user_message" ? "user" : "assistant";
    const text = codexText(payload.message ?? payload.content ?? payload.text);
    if (!text || hasNearbyCodexMessage(responseMessages, sequence - 1, role, text)) {
      return { type: "codex_duplicate_message", ...common };
    }
    if (role === "user") {
      return {
        type: "user",
        origin: { kind: "human" },
        uuid: payload.id || `codex-event-user-${sequence}`,
        message: { role: "user", content: text },
        ...common,
      };
    }
    return {
      type: "assistant",
      message: {
        id: payload.id || `codex-event-assistant-${sequence}`,
        role: "assistant",
        content: [{ type: "text", text }],
      },
      ...common,
    };
  }

  if ((envelope.type === "response_item" && payload.type === "reasoning")
    || (envelope.type === "event_msg" && /reasoning/i.test(String(payload.type || "")))) {
    return {
      type: "assistant",
      message: {
        id: payload.id || `codex-reasoning-${sequence}`,
        role: "assistant",
        content: [{ type: "thinking" }],
      },
      ...common,
    };
  }

  if (envelope.type === "response_item" && payload.type === "function_call") {
    const parsedInput = parseJsonObject(payload.arguments);
    const isShell = new Set(["shell_command", "exec_command"]).has(payload.name);
    return {
      type: "assistant",
      message: {
        id: payload.id || `codex-function-${sequence}`,
        role: "assistant",
        content: [{
          type: "tool_use",
          id: payload.call_id || payload.id || `codex-call-${sequence}`,
          name: isShell ? "Bash" : payload.name || "function_call",
          input: isShell ? {
            command: String(parsedInput.command || ""),
            ...(parsedInput.cwd != null ? { cwd: parsedInput.cwd } : {}),
            ...(parsedInput.workdir != null ? { workdir: parsedInput.workdir } : {}),
          } : parsedInput,
        }],
      },
      ...common,
    };
  }

  if (envelope.type === "response_item" && payload.type === "function_call_output") {
    return {
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: payload.call_id || payload.id || `codex-result-${sequence}`,
          content: codexText(payload.output),
          is_error: payload.is_error === true,
        }],
      },
      toolUseResult: isMapping(payload.result) ? payload.result : undefined,
      resultStatus: payload.is_error === true
        ? "error"
        : payload.status != null ? codexOutcomeStatus(payload.status) : "success",
      ...common,
    };
  }

  if (envelope.type === "response_item" && payload.type === "custom_tool_call") {
    const isExec = payload.name === "exec";
    return {
      type: "assistant",
      message: {
        id: payload.id || `codex-custom-${sequence}`,
        role: "assistant",
        content: [{
          type: "tool_use",
          id: payload.call_id || payload.id || `codex-custom-call-${sequence}`,
          name: isExec ? "Bash" : payload.name || "custom_tool_call",
          input: isExec ? { command: String(payload.input ?? "") } : { raw: payload.input },
        }],
      },
      ...common,
    };
  }

  if (envelope.type === "response_item" && payload.type === "custom_tool_call_output") {
    return {
      type: "user",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: payload.call_id || payload.id || `codex-custom-result-${sequence}`,
          content: codexText(payload.output),
          is_error: payload.is_error === true,
        }],
      },
      toolUseResult: isMapping(payload.result) ? payload.result : undefined,
      resultStatus: payload.is_error === true
        ? "error"
        : payload.status != null ? codexOutcomeStatus(payload.status) : "success",
      ...common,
    };
  }

  if (envelope.type === "event_msg" && payload.type === "patch_apply_end") {
    const status = String(payload.status || "").toLowerCase();
    const success = payload.success === true || new Set(["success", "succeeded", "completed", "ok"]).has(status);
    const failure = payload.success === false || new Set(["failed", "failure", "error"]).has(status);
    return {
      type: "codex_patch_result",
      callId: payload.call_id || payload.id || `codex-patch-${sequence}`,
      changes: isMapping(payload.changes) ? payload.changes : {},
      patchStatus: success ? "success" : failure ? "error" : "unknown",
      output: codexText(payload.output ?? payload.message),
      ...common,
    };
  }

  return { type: "codex_metadata", ...common };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripTagBlock(text, tag) {
  const pattern = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>.*?</${escapeRegExp(tag)}>`, "gis");
  return text.replace(pattern, "");
}

export function cleanHumanText(text) {
  const reasons = [];
  let cleaned = text;
  for (const tag of NOISE_BLOCKS) {
    const updated = stripTagBlock(cleaned, tag);
    if (updated !== cleaned) {
      reasons.push(tag);
      cleaned = updated;
    }
  }
  for (const tag of ["command-name", "command-message", "command-args"]) {
    cleaned = stripTagBlock(cleaned, tag);
  }
  cleaned = cleaned.trim();
  if (NOISE_PREFIXES.some((prefix) => cleaned.startsWith(prefix))) {
    reasons.push("synthetic-prefix");
    cleaned = "";
  }
  return [cleaned, reasons];
}

export function isRealHuman(record) {
  return record.type === "user" && isMapping(record.origin) && record.origin.kind === "human" && record.isMeta !== true;
}

function timezoneParts(date, timezone) {
  if (timezone.kind === "fixed") {
    const shifted = new Date(date.getTime() + timezone.offsetMinutes * 60_000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
      microsecond: date.microsecond ?? shifted.getUTCMilliseconds() * 1000,
      offsetMinutes: timezone.offsetMinutes,
    };
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone.name,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const second = Number(values.second);
  const microsecond = date.microsecond ?? date.getUTCMilliseconds() * 1000;
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, Math.floor(microsecond / 1000));
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    microsecond,
    offsetMinutes: Math.round((localAsUtc - date.getTime()) / 60_000),
  };
}

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

export function localDateString(date, timezone) {
  if (!(date instanceof Date)) return null;
  const parts = timezoneParts(date, timezone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function localIso(date, timezone) {
  if (!(date instanceof Date)) return null;
  const parts = timezoneParts(date, timezone);
  const sign = parts.offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(parts.offsetMinutes);
  const fraction = parts.microsecond ? `.${pad(parts.microsecond, 6)}` : "";
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}${fraction}${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

export function readRecords(source, timezone, maxText) {
  const records = [];
  const diagnostics = [];
  const before = fs.statSync(source.path, { bigint: true });
  const content = fs.readFileSync(source.path, "utf8");
  const lines = content.split(/\n/);
  const parsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const sequence = index + 1;
    const line = lines[index].endsWith("\r") ? lines[index].slice(0, -1) : lines[index];
    if (!line.trim()) continue;
    try {
      parsed.push({ sequence, envelope: JSON.parse(line) });
    } catch {
      diagnostics.push({
        kind: "malformed-jsonl",
        path: source.path,
        line: sequence,
        error: "invalid JSON",
      });
    }
  }

  const host = source.host || "claude";
  const rawEnvelopes = parsed.map((item) => item.envelope);
  const metadata = host === "codex" ? codexMetadata(rawEnvelopes, source.path) : null;
  const responseMessages = host === "codex" ? codexResponseMessages(rawEnvelopes) : [];
  for (const item of parsed) {
    const raw = item.envelope;
    const envelope = host === "codex"
      ? normalizeCodexEnvelope(raw, item.sequence, metadata, responseMessages)
      : raw;
    const timestampUtc = parseTimestamp(raw.timestamp);
    records.push({
      source: { ...source, host },
      sequence: item.sequence,
      envelope,
      timestamp_utc: timestampUtc,
      timestamp_local: timestampUtc,
      timezone,
      record_uuid: envelope.uuid,
      max_text: maxText,
    });
  }
  const after = fs.statSync(source.path, { bigint: true });
  if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
    diagnostics.push({ kind: "unstable-read", path: source.path });
  }
  return [records, diagnostics];
}

export function recordInDate(record, selectedDate) {
  return record.timestamp_local instanceof Date && localDateString(record.timestamp_local, record.timezone) === selectedDate;
}

export function canonicalSessionId(record) {
  const value = record.envelope.sessionId;
  return typeof value === "string" && value ? value : null;
}

export function iterContentBlocks(record) {
  const message = record.envelope.message;
  if (!isMapping(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isMapping);
}

export function classifyCommand(command) {
  const normalized = command.toLowerCase().trim().split(/\s+/).filter(Boolean).join(" ");
  if (normalized.includes("git commit")) return "commit";
  if (/\bgit\s+status\b/.test(normalized)) return "git_status";
  if (/\bgit\s+diff\b/.test(normalized)) return "git_diff";
  if (TEST_PATTERNS.some((pattern) => normalized.includes(pattern))) return "test";
  return "shell";
}

export function classifyTool(name, toolInput) {
  const normalizedName = String(name || "").toLowerCase();
  if (new Set(["Read", "Glob", "Grep", "LSP", "ListMcpResourcesTool", "ReadMcpResourceTool"]).has(name)) return "read";
  if (name === "Write") return "file_write";
  if (new Set(["Edit", "NotebookEdit"]).has(name) || normalizedName.includes("apply_patch")) return "file_edit";
  if (new Set(["Bash", "PowerShell"]).has(name)) return classifyCommand(String(toolInput.command || ""));
  if (new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskGet"]).has(name)) return "task_tracking";
  if (name === "AskUserQuestion" || normalizedName === "request_user_input") return "question";
  if (name === "Skill") return "skill_control";
  if (new Set(["Agent", "Workflow"]).has(name)
    || /(?:spawn|delegate|task|agent|send_input)/.test(normalizedName)) return "delegation";
  if (new Set(["PushNotification", "CronCreate", "CronDelete"]).has(name)) return "notification";
  return "other";
}

export function resultStatus(result, inDate) {
  if (result == null) return "missing";
  if (!inDate) return "outside_date_window";
  if (result.explicit_status === "error") return "error";
  const block = result.block || {};
  if (block.is_error === true) return "error";
  const outer = result.outer;
  if (isMapping(outer)) {
    for (const key of ["exitCode", "exit_code", "code"]) {
      if (Number.isInteger(outer[key]) && outer[key] !== 0) return "error";
    }
    const status = String(outer.status || "").toLowerCase();
    if (new Set(["failed", "failure", "error", "denied"]).has(status)) return "error";
    if (new Set(["completed", "success", "succeeded", "ok"]).has(status)) return "success";
  }
  const content = block.content;
  if (typeof content === "string") {
    const match = /(?:exit code|exited with code|Process exited with code)\s*:?\s*(\d+)/i.exec(content);
    if (match) return Number(match[1]) === 0 ? "success" : "error";
  }
  if (result.explicit_status === "success") return "success";
  if (result.explicit_status === "unknown") return "unknown";
  return typeof content === "string" && content.length > 0 ? "success" : "unknown";
}

export function summarizeResult(result, maxText) {
  if (result == null) return null;
  const block = result.block || {};
  const content = block.content;
  const summary = typeof content === "string"
    ? truncate(sanitizeText(content.trim()), Math.min(maxText, 1200))
    : { text: "", truncated: false, original_chars: 0 };
  const outer = result.outer;
  return {
    line: result.sequence,
    timestamp_local: iso(result.timestamp_local, result.timezone),
    is_error: block.is_error ?? false,
    summary,
    structured_keys: isMapping(outer) ? Object.keys(outer).sort() : [],
  };
}

export function iso(value, timezone) {
  return value instanceof Date ? localIso(value, timezone) : null;
}

export function extractExitCode(result) {
  if (result == null) return null;
  const outer = result.outer;
  if (isMapping(outer)) {
    for (const key of ["exitCode", "exit_code", "code"]) {
      if (Number.isInteger(outer[key])) return outer[key];
    }
  }
  const content = result.block?.content;
  if (typeof content === "string") {
    const match = /(?:exit code|exited with code|Process exited with code)\s*:?\s*(\d+)/i.exec(content);
    if (match) return Number(match[1]);
  }
  return null;
}

export function extractDecisionAnswers(result) {
  if (result == null) return [null, null];
  const outer = result.outer;
  if (isMapping(outer) && isMapping(outer.answers) && Object.keys(outer.answers).length > 0) {
    return [sanitize(outer.answers), "toolUseResult.answers"];
  }
  const content = result.block?.content;
  let structured = content;
  if (typeof content === "string") {
    try {
      structured = JSON.parse(content);
    } catch {
      const stripped = content.trim();
      return stripped ? [{ _text: sanitizeText(stripped) }, "tool_result_text"] : [null, null];
    }
  }
  if (isMapping(structured) && isMapping(structured.answers) && Object.keys(structured.answers).length > 0) {
    return [sanitize(structured.answers), "tool_result.answers"];
  }
  return [null, null];
}

export function parseCommit(result) {
  if (result == null || typeof result.block?.content !== "string") return [null, null];
  const content = result.block.content;
  let match = /\[\S+\s+([0-9a-f]{7,40})\]\s+(.+)/.exec(content);
  if (match) return [match[1], match[2].trim()];
  match = /\b([0-9a-f]{40})\b/.exec(content);
  return match ? [match[1], null] : [null, null];
}

function isSafeSessionId(sessionId) {
  return typeof sessionId === "string"
    && sessionId.length > 0
    && !path.isAbsolute(sessionId)
    && !path.win32.isAbsolute(sessionId)
    && !path.posix.isAbsolute(sessionId)
    && !/[\\/]/.test(sessionId)
    && sessionId !== "."
    && sessionId !== "..";
}

export function subagentMetadata(sessionRoots, sessionId) {
  if (!isSafeSessionId(sessionId)) {
    return { mode: "metadata_only", count: 0, agents: [], duplicates_ignored: 0, invalid_session_id: true };
  }
  const agentsByKey = new Map();
  let duplicates = 0;
  for (const sessionRoot of sessionRoots) {
    const directory = path.join(sessionRoot, sessionId, "subagents");
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue;
    for (const entry of sortedDirectoryEntries(directory)) {
      if (!entry.isFile() || !/^agent-.*\.jsonl$/.test(entry.name)) continue;
      const transcript = path.join(directory, entry.name);
      const agentId = path.basename(entry.name, ".jsonl").replace(/^agent-/, "");
      const metaPath = transcript.slice(0, -".jsonl".length) + ".meta.json";
      let meta = {};
      if (fs.existsSync(metaPath) && fs.statSync(metaPath).isFile()) {
        try {
          const loaded = JSON.parse(fs.readFileSync(metaPath, "utf8"));
          if (isMapping(loaded)) meta = loaded;
        } catch {
          // Metadata is optional and intentionally ignored when unreadable.
        }
      }
      const key = String(meta.toolUseId || `${agentId}:${normalizePath(transcript)}`);
      if (agentsByKey.has(key)) {
        duplicates += 1;
        continue;
      }
      agentsByKey.set(key, {
        agent_id: agentId,
        agent_type: meta.agentType ?? null,
        description: typeof meta.description === "string" ? sanitizeText(meta.description) : null,
        spawn_tool_use_id: meta.toolUseId ?? null,
        spawn_depth: meta.spawnDepth ?? null,
        stopped_by_user: meta.stoppedByUser ?? false,
        transcript_path: normalizePath(transcript),
      });
    }
  }
  const agents = [...agentsByKey.keys()].sort().map((key) => agentsByKey.get(key));
  return { mode: "metadata_only", count: agents.length, agents, duplicates_ignored: duplicates };
}

function counterIncrement(counter, key) {
  counter.set(key, (counter.get(key) || 0) + 1);
}

function counterMostCommon(values) {
  const counts = new Map();
  const firstSeen = new Map();
  values.forEach((value, index) => {
    if (!firstSeen.has(value)) firstSeen.set(value, index);
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || firstSeen.get(left[0]) - firstSeen.get(right[0]))[0]?.[0] ?? null;
}

export function buildSession(sessionId, records, selectedDate, maxText) {
  const selected = records.filter((record) => recordInDate(record, selectedDate));
  if (selected.length === 0) return null;

  const humanRequests = [];
  const filtered = new Map();
  const unclassified = [];
  const assistantGroups = new Map();
  const toolUses = new Map();
  const toolResults = new Map();
  const patchResults = new Map();
  const cwdValues = [];
  const branchValues = [];

  for (const record of records) {
    const envelope = record.envelope;
    if (typeof envelope.cwd === "string" && recordInDate(record, selectedDate)) cwdValues.push(envelope.cwd);
    if (typeof envelope.gitBranch === "string" && recordInDate(record, selectedDate)) branchValues.push(envelope.gitBranch);

    if (envelope.type === "user" && recordInDate(record, selectedDate)) {
      if (isRealHuman(envelope)) {
        const message = envelope.message;
        const content = isMapping(message) ? message.content : "";
        const [cleaned, reasons] = cleanHumanText(extractText(content));
        for (const reason of reasons) counterIncrement(filtered, reason);
        if (cleaned) {
          humanRequests.push({
            id: envelope.uuid != null ? sanitizeText(String(envelope.uuid)) : null,
            line: record.sequence,
            timestamp_local: iso(record.timestamp_local, record.timezone),
            source: envelope.promptSource ?? null,
            cwd: envelope.cwd ?? null,
            content: truncate(sanitizeText(cleaned), maxText),
          });
        } else {
          counterIncrement(filtered, "empty-after-cleaning");
        }
      } else {
        const blocks = iterContentBlocks(record);
        if (blocks.some((block) => block.type === "tool_result")) counterIncrement(filtered, "tool-result-as-user");
        else if (envelope.isMeta === true) counterIncrement(filtered, "meta-user-record");
        else if (envelope.origin == null) unclassified.push({ line: record.sequence, type: envelope.type ?? null });
      }
    }

    if (envelope.type === "codex_patch_result" && typeof envelope.callId === "string") {
      patchResults.set(envelope.callId, {
        sequence: record.sequence,
        timestamp_local: record.timestamp_local,
        timezone: record.timezone,
        in_date: recordInDate(record, selectedDate),
        status: envelope.patchStatus,
        changes: envelope.changes,
        output: envelope.output,
      });
    }

    if (envelope.type === "assistant") {
      const message = envelope.message;
      if (isMapping(message) && typeof message.id === "string") {
        if (!assistantGroups.has(message.id)) assistantGroups.set(message.id, []);
        assistantGroups.get(message.id).push(record);
      }
      for (const block of iterContentBlocks(record)) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          const existing = toolUses.get(block.id);
          if (existing == null || record.sequence < existing.sequence) {
            toolUses.set(block.id, {
              sequence: record.sequence,
              timestamp_local: record.timestamp_local,
              timezone: record.timezone,
              in_date: recordInDate(record, selectedDate),
              message_id: isMapping(message) ? message.id ?? null : null,
              block,
            });
          }
        }
      }
    }

    for (const block of iterContentBlocks(record)) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        toolResults.set(block.tool_use_id, {
          sequence: record.sequence,
          timestamp_local: record.timestamp_local,
          timezone: record.timezone,
          in_date: recordInDate(record, selectedDate),
          block,
          outer: envelope.toolUseResult,
          explicit_status: envelope.resultStatus,
        });
      }
    }
  }

  const assistantMessages = [];
  for (const [messageId, fragments] of assistantGroups.entries()) {
    if (!fragments.some((fragment) => recordInDate(fragment, selectedDate))) continue;
    const ordered = [...fragments].sort((left, right) => {
      const byPath = left.source.path < right.source.path ? -1 : left.source.path > right.source.path ? 1 : 0;
      return byPath || left.sequence - right.sequence;
    });
    const texts = [];
    let thinkingCount = 0;
    const ids = [];
    let model = null;
    let stopReason = null;
    for (const fragment of ordered) {
      const message = fragment.envelope.message || {};
      model = model || message.model || null;
      stopReason = message.stop_reason || stopReason;
      for (const block of iterContentBlocks(fragment)) {
        if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
        else if (block.type === "thinking") thinkingCount += 1;
        else if (block.type === "tool_use" && typeof block.id === "string" && !ids.includes(block.id)) ids.push(block.id);
      }
    }
    assistantMessages.push({
      message_id: messageId,
      model,
      stop_reason: stopReason,
      first_line: Math.min(...ordered.map((item) => item.sequence)),
      last_line: Math.max(...ordered.map((item) => item.sequence)),
      visible_text: truncate(sanitizeText(texts.join("\n")), maxText),
      thinking_block_count: thinkingCount,
      tool_use_ids: ids,
      crosses_date_window: ordered.some((item) => !recordInDate(item, selectedDate)),
    });
  }
  assistantMessages.sort((left, right) => left.first_line - right.first_line);

  const toolActions = [];
  const decisions = [];
  const fileChanges = [];
  const tests = [];
  const commits = [];
  const taskTracking = [];

  for (const [toolUseId, call] of [...toolUses.entries()].sort((left, right) => left[1].sequence - right[1].sequence)) {
    if (!call.in_date) continue;
    const block = call.block;
    const name = String(block.name || "");
    const toolInput = isMapping(block.input) ? block.input : {};
    const result = toolResults.get(toolUseId) || null;
    const patchResult = patchResults.get(toolUseId) || null;
    const effectiveResult = patchResult ? {
      sequence: patchResult.sequence,
      timestamp_local: patchResult.timestamp_local,
      timezone: patchResult.timezone,
      in_date: patchResult.in_date,
      block: { content: patchResult.output, is_error: patchResult.status === "error" },
      outer: { changes: patchResult.changes },
      explicit_status: patchResult.status,
    } : result;
    const status = resultStatus(effectiveResult, Boolean(effectiveResult && effectiveResult.in_date));
    const category = classifyTool(name, toolInput);
    const sanitizedInput = sanitizeToolInput(toolInput);
    toolActions.push({
      tool_use_id: toolUseId,
      name,
      category,
      line: call.sequence,
      timestamp_local: iso(call.timestamp_local, call.timezone),
      input: sanitizedInput,
      input_sha256: jsonSha256(sanitizedInput),
      status,
      result: summarizeResult(effectiveResult, maxText),
    });

    if (category === "question") {
      let answers = null;
      let answerSource = null;
      if (status === "success") [answers, answerSource] = extractDecisionAnswers(effectiveResult);
      let decisionStatus;
      if (answers) decisionStatus = "answered";
      else if (status === "error") decisionStatus = "error";
      else if (status === "outside_date_window") decisionStatus = "outside_date_window";
      else decisionStatus = "unanswered";
      decisions.push({
        tool_use_id: toolUseId,
        status: decisionStatus,
        questions: sanitize(toolInput.questions || []),
        answers,
        answer_source: answerSource,
      });
    }

    if (new Set(["file_write", "file_edit"]).has(category)) {
      if (patchResult) {
        const applied = patchResult.status === "success"
          ? "observed_applied"
          : patchResult.status === "error" ? "failed" : "attempted_unverified";
        for (const [filePath, details] of Object.entries(patchResult.changes)) {
          const change = {
            tool_use_id: toolUseId,
            path: sanitizeText(filePath),
            operation: "file_edit",
            status: applied,
            change: sanitize(details),
          };
          Object.defineProperty(change, "raw_path", { value: filePath, enumerable: false });
          fileChanges.push(change);
        }
        if (Object.keys(patchResult.changes).length === 0) {
          fileChanges.push({ tool_use_id: toolUseId, path: null, operation: "file_edit", status: applied });
        }
      } else {
        const filePath = toolInput.file_path || toolInput.notebook_path || null;
        const applied = status === "success" ? "observed_applied" : status === "error" ? "failed" : "attempted_unverified";
        const change = {
          tool_use_id: toolUseId,
          path: typeof filePath === "string" ? sanitizeText(filePath) : filePath,
          operation: category,
          status: applied,
        };
        Object.defineProperty(change, "raw_path", { value: filePath, enumerable: false });
        fileChanges.push(change);
      }
    } else if (category === "test") {
      const exitCode = extractExitCode(effectiveResult);
      const testStatus = ({
        success: "passed",
        error: "failed",
        missing: "missing_result",
        outside_date_window: "outside_date_window",
      })[status] || "unknown";
      tests.push({
        tool_use_id: toolUseId,
        command: sanitizeText(String(toolInput.command || "")),
        status: testStatus,
        exit_code: exitCode,
      });
    } else if (category === "commit") {
      const [commitHash, subject] = parseCommit(effectiveResult);
      let commitStatus = status;
      if (status === "success" && commitHash == null) commitStatus = "attempted_unverified";
      commits.push({
        tool_use_id: toolUseId,
        command: sanitizeText(String(toolInput.command || "")),
        status: commitStatus,
        commit_hash: commitHash,
        subject: subject ? sanitizeText(subject) : null,
      });
    } else if (category === "task_tracking") {
      taskTracking.push({
        tool_use_id: toolUseId,
        name,
        status,
        input: sanitizeToolInput(toolInput),
        proves_implementation: false,
      });
    }
  }

  const host = records[0]?.source.host || "claude";
  const sessionKey = `${host}:${sessionId}`;
  const cwd = counterMostCommon(cwdValues);
  const branch = counterMostCommon(branchValues);
  const sourcePaths = [...new Set(records.map((record) => record.source.path))].sort();
  const projectHints = [...new Set(records.map((record) => record.source.project_slug).filter(Boolean))].sort();
  const sessionRoots = [...new Set(records.map((record) => record.source.session_root))].sort();
  const subagents = host === "claude" && sessionRoots.length > 0
    ? subagentMetadata(sessionRoots, sessionId)
    : { mode: "metadata_only", count: 0, agents: [], duplicates_ignored: 0 };
  const selectedTimes = selected.filter((item) => item.timestamp_local instanceof Date).map((item) => iso(item.timestamp_local, item.timezone));

  return {
    host,
    session_key: sessionKey,
    session_id: sessionId,
    source_paths: sourcePaths,
    cwd,
    project_hints: projectHints,
    git_branch: branch,
    first_selected_at: selectedTimes.sort()[0],
    last_selected_at: selectedTimes.sort().at(-1),
    human_requests: humanRequests,
    decisions,
    assistant_visible_messages: assistantMessages,
    tool_actions: toolActions,
    file_changes: fileChanges,
    tests,
    commits,
    task_tracking: taskTracking,
    subagents,
    diagnostics: {
      filtered_counts: Object.fromEntries([...filtered.entries()].sort(([left], [right]) => left.localeCompare(right))),
      unclassified_user_records: unclassified,
    },
  };
}

function pathFlavor(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.includes("\\")
    ? "windows"
    : "posix";
}

function normalizedPathParts(value) {
  const flavor = pathFlavor(value);
  const normalized = flavor === "windows"
    ? path.win32.normalize(value.replaceAll("/", "\\"))
    : path.posix.normalize(value);
  const separator = flavor === "windows" ? /[\\/]+/ : /\/+/;
  const parts = normalized.split(separator).filter((part) => part && part !== ".");
  return {
    flavor,
    parts: flavor === "windows" ? parts.map((part) => part.toLowerCase()) : parts,
  };
}

export function windowsPathParts(value) {
  const normalized = path.win32.normalize(value.replaceAll("/", "\\"));
  return normalized.split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
}

export function pathIsWithin(filePath, root) {
  const candidate = normalizedPathParts(filePath);
  const parent = normalizedPathParts(root);
  if (candidate.flavor !== parent.flavor) return false;
  return candidate.parts.length >= parent.parts.length
    && parent.parts.every((part, index) => candidate.parts[index] === part);
}

function isAbsoluteAnyPlatform(value) {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value);
}

function basenameAnyPlatform(value) {
  return path.win32.basename(value.replaceAll("/", "\\"));
}

export function projectIndex(sessions) {
  const observedRoots = [];
  for (const session of sessions) {
    if (session.cwd) observedRoots.push(String(session.cwd).replaceAll("\\", "/"));
    for (const action of session.tool_actions || []) {
      for (const key of ["cwd", "workdir"]) {
        const value = action.input?.[key];
        if (typeof value === "string" && isAbsoluteAnyPlatform(value)) {
          observedRoots.push(value.replaceAll("\\", "/"));
        }
      }
    }
  }
  const knownRoots = [...new Set(observedRoots)].sort((left, right) => right.length - left.length);
  const projects = new Map();
  const externalEvidence = [];

  for (const session of sessions) {
    const assigned = new Set();
    if (session.cwd) assigned.add(String(session.cwd).replaceAll("\\", "/"));
    for (const action of session.tool_actions || []) {
      for (const key of ["cwd", "workdir"]) {
        const value = action.input?.[key];
        if (typeof value === "string" && isAbsoluteAnyPlatform(value)) {
          assigned.add(value.replaceAll("\\", "/"));
        }
      }
    }
    for (const change of session.file_changes || []) {
      const filePath = change.raw_path ?? change.path;
      if (typeof filePath !== "string" || !isAbsoluteAnyPlatform(filePath)) continue;
      const normalized = filePath.replaceAll("\\", "/");
      const matched = knownRoots.find((root) => pathIsWithin(normalized, root));
      if (matched) assigned.add(matched);
      else {
        externalEvidence.push({
          host: session.host || "claude",
          session_key: session.session_key || `${session.host || "claude"}:${session.session_id}`,
          session_id: session.session_id,
          path: sanitizeText(normalized),
          kind: "file_change_outside_known_project",
          tool_use_id: change.tool_use_id ?? null,
        });
      }
    }
    if (assigned.size === 0 && (session.project_hints || []).length === 1) {
      assigned.add(`slug:${session.project_hints[0]}`);
    }
    if (assigned.size === 0) assigned.add("<unknown>");

    const actionById = new Map((session.tool_actions || []).map((action) => [action.tool_use_id, action]));

    for (const projectPath of [...assigned].sort()) {
      const evidenceBelongsToProject = (item) => {
        const action = actionById.get(item.tool_use_id);
        const actionRoot = action?.input?.workdir || action?.input?.cwd || session.cwd;
        if (typeof actionRoot === "string") return pathIsWithin(actionRoot, projectPath);
        return projectPath.startsWith("slug:") && assigned.size === 1;
      };
      const key = normcase(projectPath);
      if (!projects.has(key)) {
        projects.set(key, {
          path: projectPath,
          display_name: projectPath.startsWith("slug:")
            ? projectPath.slice("slug:".length)
            : projectPath !== "<unknown>" ? basenameAnyPlatform(projectPath) : "unknown",
          session_keys: [],
          session_ids: [],
          counts: { human_requests: 0, decisions: 0, file_changes: 0, tests: 0, commits: 0 },
        });
      }
      const project = projects.get(key);
      const sessionKey = session.session_key || `${session.host || "claude"}:${session.session_id}`;
      if (!project.session_keys.includes(sessionKey)) project.session_keys.push(sessionKey);
      if (!project.session_ids.includes(session.session_id)) project.session_ids.push(session.session_id);
      project.counts.human_requests += (session.human_requests || []).filter((item) => !item.cwd || pathIsWithin(String(item.cwd), projectPath)).length;
      project.counts.decisions += (session.decisions || []).filter(evidenceBelongsToProject).length;
      project.counts.file_changes += (session.file_changes || []).filter((item) => {
        const filePath = item.raw_path ?? item.path;
        return typeof filePath === "string" && pathIsWithin(filePath, projectPath);
      }).length;
      project.counts.tests += (session.tests || []).filter(evidenceBelongsToProject).length;
      project.counts.commits += (session.commits || []).filter(evidenceBelongsToProject).length;
    }
  }
  return [[...projects.keys()].sort().map((key) => projects.get(key)), externalEvidence];
}

export function buildDocument(sources, selectedDate, timezone, timezoneRequested, timezoneResolved, maxText) {
  const grouped = new Map();
  const diagnostics = [];
  let recordsRead = 0;
  let recordsInDate = 0;
  for (const source of sources) {
    const [records, sourceDiagnostics] = readRecords(source, timezone, maxText);
    diagnostics.push(...sourceDiagnostics);
    recordsRead += records.length;
    recordsInDate += records.filter((record) => recordInDate(record, selectedDate)).length;
    for (const record of records) {
      const sessionId = canonicalSessionId(record);
      if (!sessionId) continue;
      const host = record.source.host || "claude";
      const sessionKey = `${host}:${sessionId}`;
      if (!grouped.has(sessionKey)) grouped.set(sessionKey, { host, sessionId, records: [] });
      grouped.get(sessionKey).records.push(record);
    }
  }

  const sessions = [];
  for (const { sessionId, records } of grouped.values()) {
    const session = buildSession(sessionId, records, selectedDate, maxText);
    if (session) sessions.push(session);
  }
  sessions.sort((left, right) => left.first_selected_at.localeCompare(right.first_selected_at) || left.session_key.localeCompare(right.session_key));
  const [projects, externalPathEvidence] = projectIndex(sessions);
  return {
    schema_version: SCHEMA_VERSION,
    scan: {
      date: selectedDate,
      timezone_requested: timezoneRequested ?? null,
      timezone_resolved: timezoneResolved,
      subagent_mode: "metadata_only",
      sources: [...sources],
    },
    diagnostics: {
      files_discovered: sources.length,
      records_read: recordsRead,
      records_in_date: recordsInDate,
      sessions_matched: sessions.length,
      items: diagnostics,
    },
    projects,
    external_path_evidence: externalPathEvidence,
    sessions,
  };
}

function stablePrettyJson(value) {
  const sortRecursively = (item) => {
    if (Array.isArray(item)) return item.map(sortRecursively);
    if (isMapping(item)) {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sortRecursively(item[key])]));
    }
    return item;
  };
  return JSON.stringify(sortRecursively(value), null, 2);
}

export function writeDocument(document, output, sourcePaths, force) {
  const rendered = stablePrettyJson(document);
  if (output == null) {
    process.stdout.write(rendered + "\n");
    return;
  }
  const outputPath = expandUser(String(output));
  const normalizedOutput = normalizePath(outputPath);
  const normalizedSources = new Set([...sourcePaths].map(normcase));
  if (normalizedSources.has(normcase(normalizedOutput))) {
    throw new Error("output path must not overwrite a transcript source");
  }
  const parent = path.dirname(outputPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`output parent does not exist: ${parent}`);
  }
  if (fs.existsSync(outputPath) && !force) {
    throw new Error(`output already exists; pass --force to replace it: ${outputPath}`);
  }
  const temporary = path.join(parent, `.${path.basename(outputPath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  fs.writeFileSync(temporary, rendered + "\n", { encoding: "utf8", flag: "wx" });
  try {
    fs.renameSync(temporary, outputPath);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    }
    throw error;
  }
}

function optionValue(argv, index, option) {
  const argument = argv[index];
  const equals = argument.indexOf("=");
  if (equals !== -1) return [argument.slice(equals + 1), index];
  if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
    throw new Error(`argument ${option}: expected one argument`);
  }
  return [argv[index + 1], index + 1];
}

export function parseArgs(argv) {
  const args = {
    date: null,
    timezone_name: null,
    claude_projects_root: [],
    claude_session_root: [],
    codex_sessions_root: [],
    output: null,
    force: false,
    max_text_chars: 4000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const option = argument.split("=", 1)[0];
    if (argument === "-h" || argument === "--help") {
      args.help = true;
    } else if (option === "--date") {
      let value;
      [value, index] = optionValue(argv, index, "--date");
      args.date = parseDate(value);
    } else if (option === "--timezone") {
      [args.timezone_name, index] = optionValue(argv, index, "--timezone");
    } else if (option === "--projects-root" || option === "--claude-projects-root") {
      let value;
      [value, index] = optionValue(argv, index, option);
      args.claude_projects_root.push(value);
    } else if (option === "--session-root" || option === "--claude-session-root") {
      let value;
      [value, index] = optionValue(argv, index, option);
      args.claude_session_root.push(value);
    } else if (option === "--codex-sessions-root") {
      let value;
      [value, index] = optionValue(argv, index, "--codex-sessions-root");
      args.codex_sessions_root.push(value);
    } else if (option === "--output") {
      [args.output, index] = optionValue(argv, index, "--output");
    } else if (argument === "--force") {
      args.force = true;
    } else if (option === "--max-text-chars") {
      let value;
      [value, index] = optionValue(argv, index, "--max-text-chars");
      if (!/^[+-]?\d+$/.test(value)) throw new Error(`argument --max-text-chars: invalid int value: ${JSON.stringify(value)}`);
      args.max_text_chars = Number(value);
    } else {
      throw new Error(`unrecognized arguments: ${argument}`);
    }
  }
  if (args.help) return args;
  if (args.date == null) throw new Error("the following arguments are required: --date");
  if (args.claude_projects_root.length > 0 && args.claude_session_root.length > 0) {
    throw new Error("argument --claude-session-root/--session-root: not allowed with argument --claude-projects-root/--projects-root");
  }
  args.projects_root = args.claude_projects_root;
  args.session_root = args.claude_session_root;
  return args;
}

function printCliError(message) {
  process.stderr.write("usage: scan_sessions.mjs [-h] --date DATE [--timezone TIMEZONE_NAME]\n");
  process.stderr.write("                         [--claude-projects-root ROOT | --claude-session-root ROOT]\n");
  process.stderr.write("                         [--codex-sessions-root ROOT]\n");
  process.stderr.write("                         [--output OUTPUT] [--force]\n");
  process.stderr.write("                         [--max-text-chars MAX_TEXT_CHARS]\n");
  process.stderr.write(`scan_sessions.mjs: error: ${message}\n`);
}

export function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
    if (args.help) {
      process.stdout.write(HELP);
      return 0;
    }
    if (args.max_text_chars <= 0) throw new Error("--max-text-chars must be greater than zero");
    const [timezone, timezoneResolved] = resolveTimezone(args.timezone_name);
    const sources = discoverTranscripts(
      args.claude_projects_root,
      args.claude_session_root,
      args.codex_sessions_root,
    );
    const document = buildDocument(
      sources,
      args.date,
      timezone,
      args.timezone_name,
      timezoneResolved,
      args.max_text_chars,
    );
    writeDocument(document, args.output, new Set(sources.map((source) => source.path)), args.force);
    return 0;
  } catch (error) {
    printCliError(error.message);
    return 2;
  }
}

export {
  buildParser as build_parser,
  buildDocument as build_document,
  buildSession as build_session,
  canonicalSessionId as canonical_session_id,
  classifyCommand as classify_command,
  classifyTool as classify_tool,
  cleanHumanText as clean_human_text,
  discoverTranscripts as discover_transcripts,
  extractDecisionAnswers as extract_decision_answers,
  extractExitCode as extract_exit_code,
  extractText as extract_text,
  isRealHuman as is_real_human,
  iterContentBlocks as iter_content_blocks,
  jsonSha256 as json_sha256,
  normalizePath as normalize_path,
  parseCommit as parse_commit,
  parseDate as parse_date,
  parseTimestamp as parse_timestamp,
  pathIsWithin as path_is_within,
  projectIndex as project_index,
  readRecords as read_records,
  recordInDate as record_in_date,
  resolveTimezone as resolve_timezone,
  resultStatus as result_status,
  sanitizeText as sanitize_text,
  sanitizeToolInput as sanitize_tool_input,
  stripTagBlock as strip_tag_block,
  subagentMetadata as subagent_metadata,
  summarizeResult as summarize_result,
  windowsPathParts as windows_path_parts,
  writeDocument as write_document,
};

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
  } catch {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  }
}

if (isCliEntry()) {
  process.exitCode = main();
}
