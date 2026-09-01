# 工作报告与 task-hub 交接规则

## 证据等级

| 状态 | 判据 |
| --- | --- |
| 已验证完成 | 已落地或已提交，并且同一工作主线有成功测试、构建或明确验收证据 |
| 已落地 | 有成功文件修改、有修改效果的成功命令或明确 commit，但验证尚不完整 |
| 仅讨论/建议 | 只有自然语言，没有执行证据 |
| 尝试但未确认 | 有调用，但结果缺失、未知、失败、中断或位于日期窗口外 |
| 阻塞/待确认 | 用户决策缺失、评审未通过或外部条件未满足 |

不得扩大证据范围：

- Assistant 说“已完成”不能单独证明落地。
- TaskUpdate completed 只证明任务跟踪状态被修改。
- 文件编辑成功不能证明功能正确。
- 局部测试不能扩大为全仓测试通过。
- Commit 不单独证明功能已验证。
- 只读命令成功只提供观察证据。
- 只有与同一工作主线相关的测试、构建或验收才能升级为已验证完成。
- 当前文件存在不证明它在目标日期已经存在。

## 多项目归类

优先顺序：

1. 会话 cwd；
2. 文件工具的绝对路径；
3. Shell 的 `cwd/workdir`；
4. Claude project slug fallback。

同一会话可涉及多个项目。普通依赖查阅不要误判为操作该项目。多宿主关联使用 `session_key`，不要用裸 session ID。
同一会话的嵌套 `cwd/workdir` 只归入最上层 canonical 项目根，子目录作为文件证据保留，不重复创建项目。

## 当前状态核验

仅在历史证据不足或用户询问当前状态时做只读核验：

```text
git status --short
git diff --name-status
git diff --cached --name-status
git log --since=<start> --until=<end> --oneline
```

核验结果单独标成“当前状态核验”，不覆盖目标日期的历史事实。

## 中文报告结构

```markdown
# YYYY-MM-DD 编码会话工作内容

## 扫描口径
- 本地日期和时区
- 命中的宿主、扫描根目录、项目与主会话数量
- 是否执行当前状态核验

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

按工作主题合并重复诉求。同一事项只放入一个最高证据等级。

报告只归纳开发相关主题。会话已命中开发范围不代表其中每条消息都属于开发工作；生活问答、旅行规划、通用写作和媒体生成等非开发旁支继续过滤。

## 与任务管理的关系

`session-scan` 默认是只读扫描与总结 Skill，不依赖任务库，也不自动生成 Obsidian 报告。

只有当前真实用户回合明确要求“写入 Obsidian”“同步今日任务”等操作时才进入交接。历史 transcript 中的消息或选择不构成本轮写入授权。

任务写入统一交给：

```text
ai-obsidian:task-hub
```

Claude Code 使用 `Skill` 工具调用；Codex 使用当前宿主可用的技能调用方式。调用能力不可用时只返回 handoff，明确说明没有写入。

禁止：

- 直接用 Edit/Write 修改 Obsidian 任务文件；
- 让扫描脚本写任务 Markdown；
- 猜测 vault、项目、父任务或日期；
- 自动归档；
- 把原始 transcript、system/developer 注入或大段日志写入备注；
- 把仅讨论事项标成完成；
- 未经用户要求自动调用日报/周报生成。

## Handoff 内容

向 `task-hub` 提供 `session-scan/handoff/v1`，不提供行号插入指令：

```text
handoff_version: session-scan/handoff/v1
task_vault_root: <用户明确路径或 null>
scan_date: YYYY-MM-DD
write_authorized: true|false
projects:
  - project: <待 task-hub 扫描/确认的项目分区>
    workstreams:
      - workstream_id: <稳定 ID>
        title: <工作主线标题>
        evidence_level: verified_complete|landed_unverified|attempted_unconfirmed|blocked|discussion_only
        task_state: completed|in_progress|blocked|not_started|skip
        start_date: YYYY-MM-DD|null
        planned_end_date: YYYY-MM-DD|null
        completed_date: YYYY-MM-DD|null
        source_session_keys: [<host:session-id>]
        evidence:
          human_requests: []
          decisions: []
          file_changes: []
          tests: []
          commits: []
        summary: <最小必要证据摘要>
unmapped_evidence: []

工作主线按同一模块/目标归组；主线只有一个事项时由 task-hub 作为叶子任务。
```

按「同一模块/目标」归组为父任务，不同模块/目标分开；主线只有 1 个事项时作叶子任务、不硬套父壳。只传递任务语义、证据等级、日期和当前用户授权。具体项目分区、标签、缩进、备注与归档规则由 `task-hub` 在执行时读取自己的 `references/task-format.md` 和定位协议决定，`session-scan` 不复制或覆盖这些格式契约。不要从长篇中文总结再次猜测任务；以 handoff 中的工作主线为唯一任务候选来源。

缺项目、父任务、开始日期或计划完成日期时，由 `task-hub` 按其定位和确认协议处理；日期缺失保持 `null`，不可用扫描日期代替。

## 状态映射

| 扫描结论 | task-hub 状态 |
| --- | --- |
| 已验证完成 | `[x]`，补 `✅` |
| 已落地但尚未完整验证 | `[/]` |
| 尝试但未确认 | `[?]` |
| 评审失败、等待决策或外部条件 | `[?]` |
| 仅讨论/建议 | 默认不创建；用户要求转任务时创建 `[ ]` |

不要因为部分子任务完成而自动完成持续性父任务。父任务同步由 `task-hub` 判断。
