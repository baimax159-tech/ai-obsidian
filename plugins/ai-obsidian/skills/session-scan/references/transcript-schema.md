# 双宿主会话记录结构

本参考定义 `scripts/scan_sessions.mjs` 的确定性解析契约。扫描器只提取证据，不判断业务任务是否真正完成。输出 schema 为 `session-scan/v2`。

## 目录发现

### Claude Code

```text
~/.claude/projects/<project-slug>/<session-id>.jsonl
```

只读取 project 目录根级 `*.jsonl`。`<session-id>/subagents/agent-*.jsonl` 正文不并入主会话，仅读取可用 metadata，避免重复统计。

### Codex

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

递归发现 Codex sessions root 下的 JSONL。默认不读取 `~/.codex/archived_sessions`；用户可将其他目录显式作为 `--codex-sessions-root`。

默认调用同时尝试两个宿主目录；缺失的默认目录直接跳过。用户显式指定但不存在的目录属于参数错误。

## 会话标识

- Claude Code：使用 envelope 顶层 `sessionId`。
- Codex：优先使用重复 `session_meta.payload.session_id`，其次 `payload.id`，最后使用文件名中的 UUID。
- 分组键为 `session_key = <host>:<session_id>`，不能只按裸 session ID 合并。
- 每个 source 与 session 都保留 `host: claude | codex`。
- 使用 JSONL 行序保持单文件因果关系，不按 timestamp 重排。

## 本地日期

将每条 ISO 8601 `timestamp` 转到指定时区，再比较本地日期。不要使用 UTC 日期、文件修改日期或会话开始日期代替逐条筛选。

## Claude Code 适配

### 真实用户消息

主判据：

```text
type == "user"
origin.kind == "human"
isMeta != true
```

过滤 tool result、system reminder、Skill 正文、task notification、local command caveat/stdout、Request interrupted 和子代理复制 prompt。包装与真实文本同记录时只删除已知包装，保留剩余文本。

### Assistant 与工具

- 用 `sessionId + message.id` 聚合 assistant fragment。
- 只拼接 `text`，只统计 thinking 数量，不输出 thinking 内容。
- 工具调用来自 `tool_use`；结果来自 `tool_result`。
- 始终用 `tool_use.id == tool_result.tool_use_id` 关联。
- AskUserQuestion 优先读取 `toolUseResult.answers`，再读取 result 中的结构化 answers 或文本。

## Codex 适配

Codex envelope 形如：

```json
{"timestamp":"...","type":"...","payload":{}}
```

### Metadata

重复的 `session_meta` 视为同一会话快照，提取 session ID、cwd 和 `git.branch`。`turn_context` 与 `thread_settings_applied` 的 approval 字段只表示配置，不自动生成用户决策。

### 用户和 Assistant 消息

- `response_item/message(role=user)` 是规范用户消息源。
- `response_item/message(role=assistant)` 是规范可见 Assistant 消息源。
- `role=developer` 不算用户消息。
- 相邻或小窗口内文本完全相同的 `event_msg/user_message`、`event_msg/agent_message` 视为 UI 双写并去重；找不到对应 response item 时保留为 fallback。
- `response_item/reasoning` 与 `event_msg/agent_reasoning` 只计数，不输出 summary、encrypted content 或 reasoning 文本。
- `event_msg/task_complete.last_agent_message` 不再生成第三份 Assistant 消息。

### Function 与 custom tool

- `response_item/function_call.arguments` 是 JSON 字符串，最佳努力解析；保留不能解析的 raw 值。
- `function_call_output` 通过 `call_id` 关联，output 支持 string 或 `[{type,text}]`。
- `shell_command`、`exec_command` 映射为 Shell，读取其 `command` 与 `workdir/cwd`。
- `custom_tool_call(name=exec)` 映射为 Shell，opaque input 作为 command 文本。
- `request_user_input` 映射为问题/决策；委派类函数映射为 delegation。
- 未识别的 function/custom tool 保留为 `other`，不得导致扫描失败。

### Patch

`event_msg/patch_apply_end` 通过 `call_id` 与 custom call 关联。以 `success/status` 判定结果，按 `changes` map 生成文件修改证据；不能仅依赖 custom call 的 completed 状态。

## 结果状态

- `success`：结构化状态明确成功，或输出明确显示 exit code 0。
- `error`：错误标记、失败状态或非零 exit code。
- `unknown`：存在结果，但没有足够信息判定成败。
- `missing`：没有配对结果。
- `outside_date_window`：调用在目标日期，结果在日期外。

缺失或 unknown 不等同扫描器失败，也不得升级为成功。

## 项目归类

优先使用目标日期内的 session cwd，再使用工具 input 中的 `cwd/workdir`。Claude project slug 只作 fallback。外部文件修改进入 `external_path_evidence`，不自动创建新项目。

项目索引使用 `session_keys` 表达双宿主会话；`session_ids` 仅作兼容信息。

## 派生证据

- `file_changes`：Write/Edit/NotebookEdit/Codex patch 的成功、失败或未确认状态。
- `tests`：识别测试、构建和 lint 命令及 exit code。
- `commits`：只有实际 commit 命令才算提交动作。
- `task_tracking`：记录任务状态，但 `proves_implementation=false`。
- `subagents`：Claude Code 只输出 metadata；Codex 当前不递归合并子线程正文。

`git log`、`git show` 只证明观察到提交，不证明该会话创建了提交。

## 隐私和输出

- 递归脱敏 token、secret、password、authorization、cookie、credential、api_key、private_key 等结构化键。
- 对用户文本、Assistant 文本、命令和 result 做最佳努力自由文本脱敏。
- 不输出 thinking/reasoning 内容。
- 截断大型文本并记录原字符数。
- malformed JSONL 只记录路径、行号和错误，不复制原始行。
- 输出 UTF-8、稳定键序的 JSON。
