# session-scan/handoff/v1

这是 `session-scan` 交给 `task-hub` 的唯一任务候选格式。它不是原始 transcript，也不是工作报告；每个工作主线只保留最小必要证据。

## 顶层结构

```json
{
  "handoff_version": "session-scan/handoff/v1",
  "task_vault_root": null,
  "scan_date": "YYYY-MM-DD",
  "write_authorized": false,
  "projects": [],
  "unmapped_evidence": []
}
```

`write_authorized` 只有在当前用户明确要求写入 Obsidian 时才可为 `true`。`task_vault_root` 未由用户指定时保持 `null`，交给 `task-hub` 询问。

## 工作主线

```json
{
  "project": "项目分区名",
  "project_path": "D:/repo",
  "workstreams": [
    {
      "workstream_id": "ws-唯一标识",
      "title": "工作主线标题",
      "evidence_level": "verified_complete",
      "task_state": "completed",
      "start_date": null,
      "planned_end_date": null,
      "completed_date": "YYYY-MM-DD",
      "source_session_keys": ["codex:session-id"],
      "evidence": {
        "human_requests": [],
        "decisions": [],
        "file_changes": [],
        "tests": [],
        "commits": []
      },
      "summary": "只写能由 evidence 直接支持的事实"
    }
  ]
}
```

### 字段规则

- `workstream_id` 必须在本次交接内稳定且唯一；不能使用随机值。
- `title` 是任务候选标题，不要把日期、状态、测试日志或项目路径塞进标题。
- `source_session_keys` 使用 `host:session-id`，不能使用裸 session ID。
- `start_date`、`planned_end_date`、`completed_date` 缺失时必须写 `null`，不能用扫描日期、当前日期或测试日期猜测计划日期。
- `completed_date` 只有存在同一主线的完成证据时才填写；`task_state=completed` 必须同时使用 `evidence_level=verified_complete`。
- `summary` 只引用用户诉求、成功文件修改、同主线测试/构建/验收和实际提交；不复制大段 transcript。
- 同一模块/目标的多个事项合并为一条工作主线；不同模块分开；单一事项直接作为叶子任务候选。

## 证据等级与任务状态

| `evidence_level` | `task_state` | task-hub 映射 |
| --- | --- | --- |
| `verified_complete` | `completed` | `[x]` + `✅` |
| `landed_unverified` | `in_progress` | `[/]` |
| `attempted_unconfirmed` | `blocked` | `[?]` |
| `blocked` | `blocked` | `[?]` |
| `discussion_only` | `skip` | 默认不创建 |
| `discussion_only` | `not_started` | 仅在用户明确要求把建议建成任务时创建 `[ ]` |

缺失结果、未知结果、失败调用和被中断的操作统一属于 `attempted_unconfirmed` 或 `blocked`，不得写成 `in_progress`。

## task-hub 消费规则

1. 先校验 `handoff_version` 和字段完整性；校验失败只预览，不写入。
2. 只消费 `task_state` 不为 `skip` 的工作主线；不要从原始扫描摘要另起任务。
3. 先按 `project` 扫描现有分区，再按 `workstream_id`、项目、父任务和相近标题定位已有任务。
4. 日期字段为 `null` 时按工作主线集中询问一次；用户未提供前不写入任务。
5. 写入后重新读取任务树，确认状态、父子层级、项目分区和日期字段没有丢失。
