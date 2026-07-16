# opensource-research 技能

开源工具/框架调研：仅凭公开资料（不克隆、不运行、不装依赖），产出结构一致的中文调研报告。

## 触发方式

- 斜杠命令：`/ai-obsidian:opensource-research`
- 关键词：说"调研 X"、"研究下 X 这个开源项目"、"评估 X 是否值得用"，或直接给出一个 GitHub 仓库地址让评估时自动触发

## 功能

- 公开资料采集：README/官方文档 + GitHub 元数据（star/fork、发版频率、Issue/PR 活跃度、bus factor、背书）
- 选型信号：成本与锁定（license 商用限制、退出成本）、安全与供应链（遥测/隐私默认、依赖面、CLI/hook 信任边界）
- 同类对比：GitHub star 倒序 Top5，含 1 个近一年新兴项目名额（结构化信号捞取，不用单日榜单）
- Obsidian callout 版式：速览 / 结论 / 选型用 callout 色块（`[!abstract]` / `[!success]` / `[!danger]` / `[!warning]` / `[!info]`），字段带 emoji 图标锚点、同类对比首列 🥇🥈🥉 名次徽章，全篇仅同类对比一张表
- 配套 CSS snippet：`assets/调研样式.css` 靠 frontmatter `cssclasses: research-report` 只作用于调研报告（速览 hero 卡片 / 决策色条 / 斑马纹表），取色走主题变量、跟随明暗；生成报告时自动写入 vault 的 `.obsidian/snippets/` 并提示启用

## 输出

报告默认写入 `调研/<项目名>.md`（相对当前项目根目录，项目原名、无后缀；用户显式指定路径时以用户为准），一句话结论前置。

## 约束

- 仅用公开资料，不克隆、不运行、不装依赖
- 全程中文，调研日期取当天
- 参考资料附 URL
