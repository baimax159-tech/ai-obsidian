# Session Scan

扫描 Claude Code、Codex、DeepSeek Harness 与 pi 的本地会话记录，默认只保留开发相关会话，按指定本地日期整理真实工作证据，并按项目输出中文工作总结。

## 使用方式

Claude Code：

```text
/ai-obsidian:session-scan
```

Codex 安装插件后，直接请求“扫描今天的 Codex 工作记录”或“总结昨天的编码会话”；需要同时扫描 Claude Code、DeepSeek Harness 和 pi 时明确指定宿主。

默认只扫描 Codex；以下是可用的宿主默认目录，需要扩展时显式使用 `--host`：

```text
~/.claude/projects
~/.codex/sessions
~/.dsh/sessions
~/.pi/agent/sessions
```

缺失的默认目录会跳过；Codex 归档目录默认不扫描。DeepSeek Harness 的 `session.jsonl.zstd` 需要当前 Node 运行时支持 `node:zlib` 的 zstd 解码；不支持时只报告诊断，仍可扫描未压缩的 `session.jsonl`。pi 可通过 `--pi-sessions-root`、`PI_CODING_AGENT_SESSION_DIR` 或 `PI_CODING_AGENT_DIR/sessions` 指定会话目录。

例如同时扫描 Codex 和 Claude：

```text
--host codex --host claude
```

默认扫描范围为 `development`：源码或开发配置修改、测试/构建、Git、开发命令以及明确的开发诉求会保留，旅行规划、生活问答、通用写作和媒体生成等非开发内容会过滤。只有明确需要排查完整会话范围时才使用 `--scope all`。

## 输出与副作用

- 默认：只在聊天中输出证据型工作总结。
- 明确要求保存：可写出原始 `session-scan/v2` JSON。
- 明确要求同步任务：把语义交给 `ai-obsidian:task-hub`。
- 任务交接使用 `session-scan/handoff/v1`；日期未知写 `null`，不从扫描时间推断。
- 不会直接修改 Obsidian 任务文件，也不会自动生成日报/周报或自动归档。

## 证据原则

- 模型声称“完成”不等于完成。
- 文件修改证明已落地，不证明功能正确。
- Commit 不单独证明已验证。
- 只有与同一工作主线相关的成功测试、构建或验收，才能标记为已验证完成。
- Claude thinking、Codex reasoning、DeepSeek Harness reasoning、pi thinking、系统注入和工具结果不会被当成用户诉求。

详细流程见 [SKILL.md](SKILL.md)。
交接字段见 [references/handoff-schema.md](references/handoff-schema.md)。
