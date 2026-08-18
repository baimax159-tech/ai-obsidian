# ai-obsidian

> ai-obsidian: a multi-agent plugin marketplace providing skills and extensions for development workflows

> ⚠️ 本仓库由上游 `agent-forge` 自动生成并同步的**只读镜像**，请勿直接修改；如需变更请在上游仓库改动后重新发布。

## 安装

### Claude Code

```bash
/plugin marketplace add https://github.com/baimax159-tech/ai-obsidian
```

```bash
/plugin install ai-obsidian@ai-obsidian
```

### Codex

```bash
codex plugin marketplace add https://github.com/baimax159-tech/ai-obsidian --sparse .agents/plugins --sparse plugins/ai-obsidian
codex plugin add ai-obsidian@ai-obsidian
```

## 插件与技能

### ai-obsidian

Obsidian workflow toolkit for vault setup, task management, reporting, research, and Claude Code/Codex/DeepSeek Harness session scanning

| 命令 | 说明 |
|------|------|
| `/ai-obsidian:task-hub` | 统一任务入口：创建 / 查看 / 完整修改 / 归档 / 旧格式迁移 / 全周期与任意日期报告 |
| `/ai-obsidian:opensource-research` | 开源工具/框架调研：仅公开资料产出结构一致的中文调研报告到 `调研/<项目名>.md` |
| `/ai-obsidian:vault-init` | 初始化 Obsidian 顶级仓库：全动态聚合仪表盘首页 + 子库骨架 + Inbox + 入口文件 + Homepage 配置 |
| `/ai-obsidian:session-scan` | 扫描 Claude Code、Codex 与 DeepSeek Harness 会话，按日期整理工作证据并可选交接 task-hub |
| `/ai-obsidian:help` | 显示本帮助信息 |

## License

MIT

