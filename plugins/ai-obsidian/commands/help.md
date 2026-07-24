---
name: help
description: 显示 ai-obsidian 插件所有可用技能和命令的帮助信息
---

# ai-obsidian 帮助

## 可用技能

| 命令 | 说明 |
|------|------|
| `/ai-obsidian:work-management` | 管理当前项目内的 Obsidian Markdown 任务：新增 / 调整 / 查看 / 归档 / 恢复，支持父子任务与分项目 |
| `/ai-obsidian:report-generation` | 从项目内 Obsidian 任务生成工作报告：日报 / 周报 / 月报 / 季度 / 年度 / 任意日期范围 |
| `/ai-obsidian:opensource-research` | 开源工具/框架调研：仅公开资料产出结构一致的中文调研报告到 `调研/<项目名>.md` |
| `/ai-obsidian:vault-init` | 初始化 Obsidian 顶级仓库：全动态聚合仪表盘首页 + 子库骨架 + Inbox + 入口文件 + Homepage 配置 |
| `/ai-obsidian:task-hub` | 任务中枢：一个技能管创建 / 修改 / 归档 / 报告 |
| `/ai-obsidian:session-scan` | 扫描 Claude Code 与 Codex 会话，按日期整理工作证据并可选交接 task-hub |
| `/ai-obsidian:help` | 显示本帮助信息 |

## 快速使用

```
# 新增 / 查看任务、生成报告
/ai-obsidian:task-hub

# 扫描 Claude Code / Codex 会话工作
/ai-obsidian:session-scan
```

## 更多信息

- 插件主页：https://github.com/baimax159-tech/ai-obsidian
- 问题反馈：https://github.com/baimax159-tech/ai-obsidian/issues
