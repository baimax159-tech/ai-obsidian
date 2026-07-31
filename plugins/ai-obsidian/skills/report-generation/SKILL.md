---
name: report-generation
description: 已废弃的报告生成兼容入口。仅当用户显式调用 /ai-obsidian:report-generation 时用于向后兼容，并把原请求转交 ai-obsidian:task-hub；不要因自然语言报告请求自动选择此技能。
allowed-tools: Skill
---

# report-generation 兼容入口

此技能已由 `ai-obsidian:task-hub` 替代，不再执行本目录旧参考文件中的报告写入流程。

## 工作流程

保留请求 → 调用 task-hub → 无调用能力时输出 handoff。

1. 保留用户原始请求、日期范围、任务库路径和输出偏好。
2. Claude Code 使用 `Skill` 调用 `ai-obsidian:task-hub`。
3. Codex 使用当前宿主可用的原生技能调用方式进入 `task-hub`。
4. 如果宿主不能调用另一技能，只输出结构化 handoff（目标技能、原始请求、日期范围、任务库路径、输出偏好），明确说明尚未写入，并请用户改用 `task-hub`；不要执行旧报告流程。
5. 成功调用时告诉用户本次通过兼容入口转交；不要绕过同周期报告冲突确认。

禁止继续使用旧 `references/obsidian-report-spec.md` 生成新报告。旧文件仅保留一个兼容周期，供历史格式核对。

## 错误处理

| 场景 | 处理 |
| --- | --- |
| task-hub 调用不可用 | 返回 handoff，不创建或替换报告 |
| 日期范围缺失 | 把缺失字段原样交给 task-hub 确认，不在兼容层猜测 |
