# ai-obsidian

> agent-forge Codex plugin mirror: ai-obsidian

> 本仓库由上游 agent-forge 自动生成并同步的只读镜像，请勿直接修改；如需变更请在上游仓库改动后重新发布。

## 安装

以下命令针对当前发布镜像；先将仓库克隆到本地，或在已下载的发布目录中执行。

```bash
git clone https://github.com/baimax159-tech/ai-obsidian
cd ai-obsidian
```

在 Codex 中执行：

```bash
codex plugin marketplace add https://github.com/baimax159-tech/ai-obsidian --sparse .agents/plugins --sparse plugins/ai-obsidian
codex plugin add ai-obsidian@ai-obsidian
```

## 插件、技能与 MCP 能力

### ai-obsidian

Obsidian workflow toolkit for vault setup, task management, reporting, research, and Codex session scanning

详细文档：plugins/ai-obsidian/README.md

#### 技能

| Skill | 显式调用 | 说明 |
| --- | --- | --- |
| `opensource-research` | `$ai-obsidian:opensource-research` | Use when the user wants to research or evaluate an open-source tool/framework — e.g. "调研 X"、"研究下 X 这个开源项目"、"评估 X 是否值得用", or gives a GitHub repo URL to assess for adoption. Produces a structured Chinese research report at 调研/<项目名>.md. |
| `session-scan` | `$ai-obsidian:session-scan` | This skill should be used when the user asks to "扫描今天或昨天的 Claude Code/Codex/DeepSeek Harness/pi 工作记录", "按日期总结编码会话", "查看某天操作了哪些项目", "从 Claude、Codex、DeepSeek Harness 或 pi 会话整理诉求、决策、修改、测试和提交", "核对会话里的已完成和未完成事项", or explicitly asks to sync scanned results to Obsidian tasks through ai-obsidian:task-hub. |
| `task-hub` | `$ai-obsidian:task-hub` | 管理 Obsidian Markdown 任务的统一入口，覆盖创建、查看/筛选、状态与时间调整、标题/备注/优先级修改、项目移动、父子结构、归档/恢复、旧格式迁移，以及日报、周报、月报、季度、半年、年度和任意日期范围工作总结。用户提出任务管理、查看任务、完成/延期/重命名任务、生成工作报告，或显式调用 `$ai-obsidian:task-hub` 时使用。 |
| `vault-init` | `$ai-obsidian:vault-init` | 初始化 Obsidian 顶级知识仓库：一次性铺好「全动态聚合仪表盘首页 + 子库骨架 + Inbox + 入口文件 + Homepage/Dataview 配置」，让空库开箱即有可用首页。当用户说"初始化 Obsidian 仓库/知识库"、"搭建 Obsidian 首页/仪表盘/dashboard"、"新建 Obsidian vault 骨架"、"给我的笔记库做个聚合首页"或使用 `$ai-obsidian:vault-init` 时触发。 |

## License

MIT

