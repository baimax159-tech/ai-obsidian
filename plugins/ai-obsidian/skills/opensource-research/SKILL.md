---
name: opensource-research
description: Use when the user wants to research or evaluate an open-source tool/framework — e.g. "调研 X"、"研究下 X 这个开源项目"、"评估 X 是否值得用", or gives a GitHub repo URL to assess for adoption. Produces a structured Chinese research report at 调研/<项目名>.md.
allowed-tools: WebSearch, WebFetch, Read, Write, AskUserQuestion, mcp__github__search_repositories, mcp__github__get_file_contents, mcp__github__list_commits
---

# 开源工具/框架调研

调研某个开源工具/框架,产出结构一致的中文调研报告。

## 何时使用

- 用户说"调研 X"、"研究下 X 这个开源项目/工具"
- "评估 X 是否值得用 / 要不要采用 X"
- 用户直接给出一个 GitHub 仓库地址让评估

## 调研流程

1. **确认调研对象**:识别项目名或 GitHub 地址。不明确就先问清楚。
2. **采集信息(仅公开资料,不克隆不运行)**:
   - README、官方文档
   - GitHub 元数据:star/fork 数、最近提交时间、release 频率、Issue/PR 活跃度、open issue 存量、维护者集中度(bus factor)、企业/组织背书
   - 成本与锁定信号:license 商用限制、生态绑定/退出成本
   - 安全与供应链信号:遥测/隐私默认、依赖面、hook/CLI 信任边界
   - npm/包信息(如适用)
   - 优先用 WebSearch/WebFetch；GitHub MCP 可用时可补充结构化信息（search_repositories、get_file_contents、list_commits 等）。
   - **GitHub MCP 不可用时**：退化为 GitHub 公开页面、README、release 页面和官方文档；无法核实的指标标注“未验证”，不得编造 star、提交频率或 Issue 数据。
3. **找同类项目**:web 搜索同类开源项目,按 GitHub star 数倒序取 Top5;其中**留 1 个名额给"近一年新兴项目"**(用 GitHub 结构化信号捞取,如 `created:>近一年` 配合 stars 排序、或 star 增长率),其余 4 个按累计 star。不用 Repository Of The Day 等单日/编辑口味榜单——不可复现、破坏报告可比性。
4. **按模板填充**:读取 `assets/报告模板.md`,逐章节填写,替换所有 `<...>` 占位符。frontmatter 的 `cssclasses`(保留 `research-report`)、`tags`、`aliases` 一并填充。
5. **写入报告**:默认输出到 `调研/<项目名>.md`(相对当前项目根目录,项目原名,无后缀);用户显式指定路径时以用户指定为准。一句话结论前置。
6. **交付样式**:检查当前 vault 的 `.obsidian/snippets/调研样式.css` 是否存在——不存在则用 `Read` 读 skill 的 `assets/调研样式.css`、`Write` 写入该路径(幂等,已存在则跳过);随后文字提示用户去「设置 → 外观 → CSS 代码片段」打开「调研样式」开关(Obsidian 开关无法程序化点)。样式作用域限定 `research-report`,不影响其他笔记。

## 约束

- 仅用公开资料,不克隆、不运行、不装依赖。
- 全程中文输出。
- 调研日期取当天。
- 同类对比表为 star 倒序 Top5(含 1 个近一年新兴项目名额),列:项目 | Star/Fork | 定位/关键差异 | 语言·License(活跃度并入定位列);新兴项目可在定位列标注"新星"。
- 参考资料附 URL。
- **选型补充**:同类对比后附「维护健康度」`> [!info]` callout(最近活动/Issue 存量/背书·bus factor)+「成本与锁定」`> [!tip]`、「安全与供应链」`> [!caution]` callout;速览 callout 含「验证」行(仅公开资料 / 已本地实测)。已在正文充分展开的维度可只留指针,不重复。
- **Obsidian callout 版式**:顶部速览用 `> [!abstract]` callout 承载事实(粗标签带 emoji 图标锚点 + 值,不用表格);一句话结论用 `> [!quote]`,决策标签拆成 `> [!success] 适合 ✅` / `> [!danger] 别用如果 ⛔` / `> [!warning] 最大风险 ⚠️` 三个独立色块;优缺点用 `> [!success]+ 优点` / `> [!warning]+ 缺点与风险`;同类对比是全篇唯一表格,首列用 🥇🥈🥉 标注 star 前三。章节标题尾部带 emoji 图标(如 `## 三、同类对比 🔬`);配套 CSS snippet 靠 frontmatter `cssclasses: research-report` 生效,样式改动集中在 `assets/调研样式.css`。
- **扫读式排版**:正文用「加粗论点 —— 破折号半句」,不写整句论据;每节 3–5 条。忌大段文字堆积。
