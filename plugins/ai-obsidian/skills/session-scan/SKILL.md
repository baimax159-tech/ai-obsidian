---
name: session-scan
description: This skill should be used when the user asks to "扫描今天或昨天的 Claude Code/Codex 工作记录", "按日期总结编码会话", "查看某天操作了哪些项目", "从 Claude 或 Codex JSONL 整理诉求、决策、修改、测试和提交", "核对会话里的已完成和未完成事项", or explicitly asks to sync scanned results to Obsidian tasks through ai-obsidian:task-hub.
user-invocable: true
allowed-tools: Read, Skill, AskUserQuestion
compatibility: Requires Node.js 20+ with full ICU and read access to Claude Code or Codex transcript files.
metadata:
  author: project
  version: "0.2.0"
---

# Session Scan

从 Claude Code 与 Codex 的本地 JSONL 会话中提取指定日期的工作证据，按项目生成中文工作内容。严格区分“讨论过”“尝试过”“已落地”和“已验证完成”，不把模型声明或任务状态当成实现证据。

## 工作流程

确定日期与范围 → 运行只读扫描器 → 检查诊断 → 按项目归纳证据 → 必要时只读核验当前状态 → 输出中文总结 → 仅在当前用户明确要求时交接 `task-hub`。

## 步骤 1：确定日期、时区与范围

接受：

- 日期：默认当前本地日期；用户指定时使用指定值。
- 时区：优先采用用户指定时区；Windows 缺 IANA tzdata 时使用固定偏移，如 `+08:00`。
- 宿主：默认同时扫描本机存在的 Claude Code 与 Codex 会话目录。
- 输出：默认只在聊天中返回工作内容；只有用户明确要求保存原始证据时才使用 `--output`。

默认目录：

```text
~/.claude/projects
~/.codex/sessions
```

Claude Code 只读取项目目录根级主会话 JSONL，不递归合并 `subagents/*.jsonl` 正文。Codex 递归读取 `sessions/YYYY/MM/DD/*.jsonl`；默认不扫描 `archived_sessions`。

不要用文件修改时间判断日期。逐条把 transcript `timestamp` 转为目标时区后筛选。

## 步骤 2：运行确定性扫描器

从宿主加载 Skill 时提供的 base directory 获取 `<skill-base-dir>`，不要假定当前工作目录就是 Skill 目录。Claude Code 使用 Skill 加载输出中的 `Base directory for this skill`；Codex 使用已安装插件中的 `skills/session-scan` 目录。无法可靠确定时停止并要求提供插件安装路径，不猜测路径。

执行默认双宿主扫描：

```bash
node "<skill-base-dir>/scripts/scan_sessions.mjs" \
  --date YYYY-MM-DD \
  --timezone +08:00
```

限定宿主目录时可组合使用：

```bash
node "<skill-base-dir>/scripts/scan_sessions.mjs" \
  --date YYYY-MM-DD \
  --timezone +08:00 \
  --claude-projects-root "<claude-projects-root>" \
  --codex-sessions-root "<codex-sessions-root>"
```

单个 Claude project transcript 目录使用 `--claude-session-root`。兼容别名 `--projects-root`、`--session-root` 仍表示 Claude Code 路径。

优先读取 stdout。只有当前用户明确要求保存原始扫描结果时才添加：

```text
--output <path>
```

输出路径已存在时停止并询问是否覆盖；“保存到该路径”不自动代表允许覆盖。只有用户明确同意覆盖后才添加 `--force`。禁止将输出路径指向任何 transcript source。

扫描器只读 transcript；唯一可选写操作是用户指定的 JSON 输出文件。字段与宿主适配规则见 [transcript-schema.md](references/transcript-schema.md)。

## 步骤 3：检查诊断

检查：

- `files_discovered`、`records_in_date`、`sessions_matched`；
- 各 source 的 `host`；
- malformed JSONL、unstable read；
- unclassified user records；
- missing、unknown 或跨日期 tool result。

扫描为空时不要断言“没有工作”。先核对时区、默认目录是否存在、显式路径是否正确、会话是否跨 UTC 日期，以及 transcript 是否仍在追加。

## 步骤 4：按项目还原工作

按以下优先级归纳：

1. 真实用户诉求；
2. 结构化用户选择；
3. 成功 tool call/result；
4. 文件修改、测试和 commit 派生证据；
5. Assistant 可见结论；
6. 任务跟踪状态。

使用 `session_key`（`claude:<id>` / `codex:<id>`）区分宿主，避免相同 session ID 被合并。将同一主题的多轮追问合并为一个工作主线，后续明确决策覆盖早期方案。

不要把 system/developer 注入、tool result、Skill 正文、task notification、local command 输出、子代理 prompt 或 Codex 的重复 `event_msg` 算作用户沟通。不要输出 Claude thinking 或 Codex reasoning 内容。

## 步骤 5：判定证据等级

- **已验证完成**：存在落地或提交证据，且同一工作主线有成功测试、构建或明确验收。
- **已落地**：存在成功文件修改、有修改效果的命令或 commit，但验证不完整。
- **仅讨论/建议**：只有自然语言，没有执行证据。
- **尝试但未确认**：调用失败、结果缺失/未知、被中断或结果在日期窗口外。
- **阻塞/待确认**：评审未通过、用户决策缺失或外部条件未满足。

只读命令成功只提供观察证据。Commit 不单独证明功能已验证。详细矩阵见 [reporting-and-obsidian.md](references/reporting-and-obsidian.md)。

## 步骤 6：必要时核验当前状态

仅在历史证据不足或用户询问“现在”的状态时执行只读核验：

```bash
git status --short
git diff --name-status
git diff --cached --name-status
git log --since="<start>" --until="<end>" --oneline
```

将核验结果单独标为“当前状态核验”，不要用当前状态改写目标日期的历史事实。

## 步骤 7：输出中文工作内容

```markdown
# YYYY-MM-DD 编码会话工作内容

## 扫描口径
## 项目：<名称或路径>
### 用户真实诉求
### 关键决策
### 已验证完成
### 已落地但未完整验证
### 仅讨论或建议
### 文件修改
### 测试与验证
### Git 提交
### 未完成、阻塞与待确认
## 扫描异常与证据限制
```

在扫描口径中列出实际命中的宿主、项目路径和主会话数量。同一事项只放入一个最高证据等级。

## Obsidian 任务交接

默认不与任务管理联动。仅在当前真实用户回合明确要求“写入 Obsidian”“同步今日任务”等操作时：

1. 将报告压缩为项目、父任务、完成项、进行中项、阻塞项、日期和证据摘要。
2. Claude Code 使用 `Skill` 调用 `ai-obsidian:task-hub`。Codex 能调用已安装技能时调用同一 `task-hub`；不能调用时仅输出结构化 handoff，需要补字段时使用 Codex 原生文本交互，不直接猜测。
3. 让 `task-hub` 扫描项目分区、定位任务、确认缺失字段，并按其自身格式契约写入。
4. Skill 调用不可用时只返回 handoff 内容，明确说明未写入。

禁止扫描器或本 Skill 直接用 Edit/Write 修改 Obsidian 任务文件。不要自动归档，也不要自动调用报告生成；生成日报/周报等由 `task-hub` 在用户明确要求时处理。

## 错误处理

| 场景 | 处理 |
| --- | --- |
| 默认宿主目录不存在 | 跳过该宿主；两个目录都不存在时报告未发现 source |
| 显式目录不存在 | 停止并报告具体路径错误 |
| 扫描结果为空 | 核对时区、目录、跨日和追加状态，不断言无工作 |
| 输出文件已存在 | 停止并确认覆盖授权；明确同意后才使用 `--force` |
| result 缺失或未知 | 标记未确认，不升级为成功 |
| transcript 损坏 | 只报告文件、行号和解析错误，不复制原始行 |
| 任务同步缺字段 | 交给 `task-hub` 按其协议确认，不在本 Skill 内猜测 |

## 资源

- [`scripts/scan_sessions.mjs`](scripts/scan_sessions.mjs)：Claude Code/Codex 只读扫描器，输出 `session-scan/v2` 证据 JSON。
- [`references/transcript-schema.md`](references/transcript-schema.md)：双宿主目录、规范化、关联和去重规则。
- [`references/reporting-and-obsidian.md`](references/reporting-and-obsidian.md)：证据等级、中文报告和 `task-hub` handoff 规则。
- 源仓库开发测试（不随插件发布）：`tests/ai-obsidian/session-scan.test.mjs`。
