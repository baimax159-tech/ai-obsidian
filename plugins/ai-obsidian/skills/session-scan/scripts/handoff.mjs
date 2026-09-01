import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EVIDENCE_LEVELS = new Set([
  "verified_complete",
  "landed_unverified",
  "attempted_unconfirmed",
  "blocked",
  "discussion_only",
]);
const TASK_STATES = new Set(["completed", "in_progress", "blocked", "not_started", "skip"]);

export const HANDOFF_SCHEMA_VERSION = "session-scan/handoff/v1";

const FAILURE_STATUSES = new Set([
  "failed",
  "error",
  "missing_result",
  "attempted_unverified",
  "unknown",
  "outside_date_window",
]);

function stableId(projectPath, sessionKey, title) {
  return `ws-${crypto.createHash("sha256").update(`${projectPath}|${sessionKey}|${title}`).digest("hex").slice(0, 16)}`;
}

function classifyEvidence(evidence) {
  const all = [...evidence.file_changes, ...evidence.tests, ...evidence.commits];
  if (all.some((item) => FAILURE_STATUSES.has(item.status))) {
    return { evidence_level: "attempted_unconfirmed", task_state: "blocked" };
  }
  const landed = evidence.file_changes.some((item) => item.status === "observed_applied")
    || evidence.commits.some((item) => item.status === "success");
  const verified = landed && evidence.tests.some((item) => item.status === "passed");
  if (verified) return { evidence_level: "verified_complete", task_state: "completed" };
  if (landed) return { evidence_level: "landed_unverified", task_state: "in_progress" };
  return { evidence_level: "discussion_only", task_state: "skip" };
}

function workstreamTitle(request) {
  const content = request?.content;
  const text = typeof content === "string" ? content : content?.text;
  if (typeof text === "string" && text.trim()) {
    return text.trim().split(/\r?\n/, 1)[0].slice(0, 120);
  }
  return "开发修改（需确认目标）";
}

function requestText(request) {
  const content = request?.content;
  return typeof content === "string" ? content : content?.text;
}

function isContinuationRequest(request) {
  const text = requestText(request);
  if (typeof text !== "string") return false;
  const normalized = text.trim().replace(/\s+/g, "");
  return normalized.length <= 20
    && /^(?:按照步骤|按步骤|继续|开始|确认|好的?|是的|同意|就这样|照做|按你说的)?(?:修复|执行|继续|开始|确认|处理|提交|发版|发布|落实)(?:吧|一下)?$/.test(normalized);
}

function topicSpans(session) {
  const requests = [...(session.human_requests || [])]
    .filter((request) => Number.isInteger(request.line))
    .sort((left, right) => left.line - right.line);
  if (requests.length === 0) {
    return [{ index: 0, start: Number.NEGATIVE_INFINITY, end: Number.POSITIVE_INFINITY, request: session.human_requests?.[0] || null }];
  }
  const spans = [];
  for (const request of requests) {
    if (isContinuationRequest(request) && spans.length > 0) continue;
    spans.push({ start: request.line, request });
  }
  return spans.map((span, index) => ({
    index,
    start: span.start,
    end: spans[index + 1]?.start ?? Number.POSITIVE_INFINITY,
    request: span.request,
  }));
}

function spanForLine(spans, line) {
  if (!Number.isInteger(line)) return spans[0];
  return spans.find((span) => line >= span.start && line < span.end)
    || (line < spans[0].start ? spans[0] : spans.at(-1));
}

function evidenceForSpans(session, spans) {
  const actionLines = new Map((session.tool_actions || [])
    .filter((action) => typeof action.tool_use_id === "string")
    .map((action) => [action.tool_use_id, action.line]));
  const evidenceFields = ["decisions", "file_changes", "tests", "commits"];
  const perSpan = spans.map((span) => ({ human_requests: [], decisions: [], file_changes: [], tests: [], commits: [] }));
  const addByLine = (field, item) => {
    const line = Number.isInteger(item.line) ? item.line : actionLines.get(item.tool_use_id);
    const span = spanForLine(spans, line);
    perSpan[span.index][field].push(item);
  };

  for (const request of session.human_requests || []) {
    const span = spanForLine(spans, request.line);
    perSpan[span.index].human_requests.push(request);
  }
  for (const field of evidenceFields) {
    for (const item of session[field] || []) addByLine(field, item);
  }
  return perSpan;
}

/** Convert scanner evidence into the only task-hub input format. */
export function buildHandoff(document, { taskVaultRoot = null, writeAuthorized = false } = {}) {
  const sessions = document?.sessions || [];
  const sessionByKey = new Map(sessions.map((session) => [session.session_key, session]));
  const projects = (document?.projects || []).map((project) => ({
    project: project.display_name || project.path,
    project_path: project.path,
    workstreams: (project.session_keys || []).flatMap((sessionKey) => {
      const session = sessionByKey.get(sessionKey);
      const spans = topicSpans(session || {});
      const evidenceBySpan = evidenceForSpans(session || {}, spans);
      return spans.map((span, spanIndex) => {
        const evidence = evidenceBySpan[spanIndex];
        const title = workstreamTitle(span.request);
        const classification = classifyEvidence(evidence);
        const stableTitle = `${title}|${span.request?.id || span.request?.line || spanIndex}`;
        return {
          workstream_id: stableId(project.path, sessionKey, stableTitle),
          title,
          ...classification,
          start_date: null,
          planned_end_date: null,
          completed_date: null,
          source_session_keys: [sessionKey],
          evidence,
          summary: [
            evidence.human_requests.length > 0 ? `用户诉求：${title}` : "未发现明确用户诉求",
            `文件修改 ${evidence.file_changes.length} 项`,
            `测试 ${evidence.tests.length} 项`,
            `提交 ${evidence.commits.length} 项`,
          ].join("；"),
        };
      });
    }),
  }));
  return {
    handoff_version: HANDOFF_SCHEMA_VERSION,
    task_vault_root: taskVaultRoot,
    scan_date: document?.scan?.date || null,
    write_authorized: writeAuthorized,
    projects,
    unmapped_evidence: document?.external_path_evidence || [],
  };
}

function isDate(value) {
  if (value == null) return true;
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function add(errors, condition, message) {
  if (!condition) errors.push(message);
}

export function validateHandoff(value) {
  const errors = [];
  add(errors, value && typeof value === "object" && !Array.isArray(value), "handoff must be an object");
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors;

  add(errors, value.handoff_version === HANDOFF_SCHEMA_VERSION, `handoff_version must be ${HANDOFF_SCHEMA_VERSION}`);
  add(errors, typeof value.scan_date === "string" && isDate(value.scan_date), "scan_date must be YYYY-MM-DD");
  add(errors, typeof value.write_authorized === "boolean", "write_authorized must be boolean");
  add(errors, value.task_vault_root == null || typeof value.task_vault_root === "string", "task_vault_root must be string or null");
  add(errors, Array.isArray(value.projects), "projects must be an array");
  add(errors, Array.isArray(value.unmapped_evidence), "unmapped_evidence must be an array");
  const workstreamIds = new Set();

  for (const [projectIndex, project] of (value.projects || []).entries()) {
    add(errors, project && typeof project === "object" && !Array.isArray(project), `projects[${projectIndex}] must be an object`);
    if (!project || typeof project !== "object" || Array.isArray(project)) continue;
    add(errors, typeof project.project === "string" && project.project.trim() !== "", `projects[${projectIndex}].project is required`);
    add(errors, Array.isArray(project.workstreams), `projects[${projectIndex}].workstreams must be an array`);
    for (const [workstreamIndex, workstream] of (project.workstreams || []).entries()) {
      const prefix = `projects[${projectIndex}].workstreams[${workstreamIndex}]`;
      add(errors, workstream && typeof workstream === "object" && !Array.isArray(workstream), `${prefix} must be an object`);
      if (!workstream || typeof workstream !== "object" || Array.isArray(workstream)) continue;
      add(errors, typeof workstream.workstream_id === "string" && /^[A-Za-z0-9._:-]+$/.test(workstream.workstream_id), `${prefix}.workstream_id is invalid`);
      if (typeof workstream.workstream_id === "string") {
        add(errors, !workstreamIds.has(workstream.workstream_id), `${prefix}.workstream_id is duplicated`);
        workstreamIds.add(workstream.workstream_id);
      }
      add(errors, typeof workstream.title === "string" && workstream.title.trim() !== "", `${prefix}.title is required`);
      add(errors, EVIDENCE_LEVELS.has(workstream.evidence_level), `${prefix}.evidence_level is invalid`);
      add(errors, TASK_STATES.has(workstream.task_state), `${prefix}.task_state is invalid`);
      for (const field of ["start_date", "planned_end_date", "completed_date"]) {
        add(errors, Object.prototype.hasOwnProperty.call(workstream, field), `${prefix}.${field} is required`);
        add(errors, isDate(workstream[field]), `${prefix}.${field} must be YYYY-MM-DD or null`);
      }
      add(errors, Array.isArray(workstream.source_session_keys) && workstream.source_session_keys.length > 0
        && workstream.source_session_keys.every((key) => typeof key === "string" && /^(claude|codex|dsh|pi):.+$/.test(key)), `${prefix}.source_session_keys is required`);
      add(errors, workstream.evidence && typeof workstream.evidence === "object" && !Array.isArray(workstream.evidence), `${prefix}.evidence must be an object`);
      for (const field of ["human_requests", "decisions", "file_changes", "tests", "commits"]) {
        add(errors, Array.isArray(workstream.evidence?.[field]), `${prefix}.evidence.${field} must be an array`);
      }
      if (workstream.task_state === "completed") {
        add(errors, workstream.evidence_level === "verified_complete", `${prefix}.completed task must be verified_complete`);
      }
      if (workstream.evidence_level === "discussion_only") {
        add(errors, workstream.task_state === "skip" || workstream.task_state === "not_started", `${prefix}.discussion_only must be skip or not_started`);
      }
      add(errors, typeof workstream.summary === "string" && workstream.summary.trim() !== "", `${prefix}.summary is required`);
    }
  }
  return errors;
}

export function assertValidHandoff(value) {
  const errors = validateHandoff(value);
  if (errors.length > 0) throw new Error(errors.join("; "));
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  const taskVaultFlag = process.argv.indexOf("--task-vault-root");
  const taskVaultRoot = taskVaultFlag === -1 ? null : process.argv[taskVaultFlag + 1];
  const writeAuthorized = process.argv.includes("--write-authorized");
  if (!input) {
    process.stderr.write("usage: handoff.mjs EVIDENCE.json|- [--task-vault-root ROOT] [--write-authorized]\n");
    process.exitCode = 2;
  } else {
    try {
      const source = input === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(input, "utf8");
      const evidence = JSON.parse(source);
      const value = buildHandoff(evidence, { taskVaultRoot, writeAuthorized });
      const errors = validateHandoff(value);
      if (errors.length > 0) {
        process.stderr.write(errors.join("\n") + "\n");
        process.exitCode = 1;
      } else {
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
      }
    } catch (error) {
      process.stderr.write(`handoff invalid: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
