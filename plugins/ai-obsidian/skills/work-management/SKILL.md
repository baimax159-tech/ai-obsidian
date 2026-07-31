---
name: work-management
description: 已废弃的任务管理兼容入口。仅当用户显式调用 /ai-obsidian:work-management 时用于向后兼容，并把原请求转交 ai-obsidian:task-hub；不要因自然语言任务请求自动选择此技能。
allowed-tools: Skill
---

# work-management 兼容入口

此技能已由 `ai-obsidian:task-hub` 替代，不再执行本目录旧参考文件中的写入流程。

## 工作流程

保留请求 → 调用 task-hub → 无调用能力时输出 handoff。

1. 保留用户原始请求、任务库路径和已提供字段。
2. Claude Code 使用 `Skill` 调用 `ai-obsidian:task-hub`。
3. Codex 使用当前宿主可用的原生技能调用方式进入 `task-hub`。
4. 如果宿主不能调用另一技能，只输出结构化 handoff（目标技能、原始请求、任务库路径、已知字段），明确说明尚未写入，并请用户改用 `task-hub`；不要执行旧写入流程。
5. 成功调用时告诉用户本次通过兼容入口转交；不要要求重复输入已提供的信息。

禁止继续使用旧 `references/` 作为任务写入契约。旧文件仅保留一个兼容周期，供迁移核对，不代表当前格式。

## 错误处理

| 场景 | 处理 |
| --- | --- |
| task-hub 调用不可用 | 返回 handoff，不修改任务文件 |
| 用户请求旧格式迁移 | 把迁移意图原样交给 task-hub，不在兼容层处理 |
