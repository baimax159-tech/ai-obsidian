---
name: vault-init
description: 初始化 Obsidian 顶级知识仓库：一次性铺好「全动态聚合仪表盘首页 + 子库骨架 + Inbox + 入口文件 + Homepage/Dataview 配置」，让空库开箱即有可用首页。当用户说"初始化 Obsidian 仓库/知识库"、"搭建 Obsidian 首页/仪表盘/dashboard"、"新建 Obsidian vault 骨架"、"给我的笔记库做个聚合首页"或使用 /ai-obsidian:vault-init 时触发。
allowed-tools: Read, Write, Bash, Glob, AskUserQuestion
disable-model-invocation: false
---

# Obsidian 顶级仓库初始化

把「全动态聚合仪表盘首页 + 子库骨架 + Inbox + 入口文件」一次性铺到一个 Obsidian 仓库，让新库一打开就有可用首页，而不是白屏或一堆 0。

## 何时使用

- 用户说"初始化 Obsidian 仓库 / 知识库 / vault"
- "搭建 Obsidian 首页 / 仪表盘 / dashboard"、"给我的笔记库做个聚合首页"
- "新建一个 Obsidian 库的骨架 / 目录结构"

## 核心原则（先读，决定后续所有动作）

- **首页仪表盘逐字复制，绝不重写**。`assets/首页.md` 是一段精心工程化的 `dataviewjs`：子库、配色、入口、排除项全部运行时从文件系统动态发现，零 frontmatter 依赖。它靠的是**目录约定**而非配置，任何"优化""精简""改配色"都会破坏动态发现或整页白屏。用 `Read` 读出后原样 `Write`，一个字符都不改。
- **幂等**。已存在的 `首页.md` / 入口文件 / `Inbox/` 一律不覆盖——先检测，命中就跳过并告知用户，避免踩掉用户已有内容。
- **两类手动项无法程序化**，别假装能做（见步骤 5）：装社区插件（Dataview + Homepage）、开 Dataview 的 *Enable JavaScript Queries* 开关——Obsidian 的插件安装和设置开关点不动，只能引导用户手动点。

## 工作流程

确认目标库根 → 询问子库集合 → 展示创建清单并确认 → 铺目录骨架 → 配 Homepage → 汇报手动项

---

## 步骤 1：确认目标仓库根

默认取当前工作目录为仓库根。若不确定用户指的是哪个库，用一句话确认路径（"就在当前目录 `<cwd>` 初始化，对吗？"）。

用 `Bash` 探测现状，决定是全新初始化还是增量补齐：

```bash
ls -la              # 看是否已有 首页.md / Inbox/ / 子库文件夹
ls -d .obsidian/plugins/*/ 2>/dev/null   # 看 Dataview / homepage 是否已装
```

- 有 `.obsidian/` → 已是 Obsidian 库，增量补缺失件。
- 无 `.obsidian/` → 空目录，照铺；提示用户初次需用 Obsidian「Open folder as vault」打开本目录。

## 步骤 2：询问子库集合

空库直接铺首页只有 Hero 和一堆 0，观感差。**至少预置 2~4 个子库**，每个子库放一个同名入口文件，让首页底部「子库入口」有目标可跳。

用 `宿主原生交互工具` 让用户选子库集合：

- **问题**：这个库要预置哪些子库？（顶层文件夹即子库，首页按名称排序、按数量自适应配色）
- **选项**（multiSelect）：
  - `工作`（业务、任务、报告）
  - `技术`（组件、语言、工具笔记）
  - `个人`（生活、清单、计划）
  - `其他`（杂项、临时归档）
  - 用户可通过 "Other" 自填中英文子库名

用户没特别要求就用默认四件套 `工作 / 技术 / 个人 / 其他`。

在任何写入前，展示将创建的首页、Inbox、子库、入口文件及可能写入的 Homepage 配置；要求用户明确确认“开始初始化”。仅提出“想搭建”或浏览方案时只展示清单，不写文件。

## 步骤 3：铺目录骨架

按下表铺文件，**每一件先检测存在性，已存在则跳过**：

| 产物 | 来源 | 说明 |
|------|------|------|
| `首页.md` | `Read` skill 的 `assets/首页.md` → 原样 `Write` 到库根 | 仪表盘，逐字复制，勿改 |
| `Inbox/.gitkeep` | 空占位 | 收件箱，首页单独统计「待整理」，不计入子库占比 |
| `<子库>/` 每个 | `Bash mkdir -p` | 顶层文件夹即子库 |
| `<子库>/<子库>.md` 每个 | `Read` `assets/入口文件模板.md` → 替换占位符 → `Write` | folder note，首页三级兜底找入口时最稳的一级 |

**入口文件占位替换**：模板里的 `{{子库名}}` 出现 3 处（标题、索引说明、`FROM "{{子库名}}"`），全部替换成实际子库名。例如子库「技术」→ 标题 `# 技术`、`FROM "技术"`。模板已带 `tags: [hub]`，与「同名 folder note」构成双保险，首页必能识别入口。

> 入口靠**同名 folder note** 或 **hub 标签**被首页识别（三级兜底：同名笔记 → 含 `moc`/`hub`/`index`/`看板`/`首页`/`dashboard` 标签 → 篇幅最大）。用「同名 + hub 标签」双保险最稳。

## 步骤 4：配置 Homepage（启动自动打开首页）

Homepage 插件让 Obsidian 启动时自动打开首页。它的配置文件是 `.obsidian/plugins/homepage/data.json`。

- **`.obsidian/plugins/homepage/` 存在**（插件已装）→ 用 `Read` 检测有无 `data.json`；无则 `Write` 写入下方内容，有则不动（尊重用户既有配置，仅提示可将 `value` 改为 `首页`）。
- **目录不存在**（插件没装）→ **不要**创建它，写了也不生效。改为在步骤 5 告知用户「先装 Homepage 插件，装完回来我再写配置」。

```json
{
  "version": 4,
  "homepages": {
    "Main Homepage": {
      "value": "首页",
      "kind": "File",
      "openOnStartup": true,
      "openMode": "Replace all open notes",
      "revertView": true,
      "autoCreate": false
    }
  }
}
```

> `value` 填首页文件名（不含 `.md`）。首页若不叫「首页」，同步改这里。

## 步骤 5：汇报无法自动化的手动项

铺完后，给用户一份**必做手动清单**——这些无法由当前宿主自动完成，漏了会白屏：

1. **装两个社区插件**：`Dataview`（必需，渲染整个仪表盘）、`Homepage`（必需，启动自动打开首页），各自 Enable。
2. **开 Dataview 的 JS 查询**：设置 → Dataview → **Enable JavaScript Queries = 开**（关掉则 `dataviewjs` 不执行，整页白屏；建议 Enable Inline JS 也开）。
3. **指 Homepage 到首页**：若步骤 4 因插件未装没能写 `data.json`，装完后到 设置 → Homepage 把首页指向 `首页`、勾 Open on startup（或让当前宿主补写 `data.json`）。
4. **重启验证**：重开 Obsidian，首页应自动打开并渲染出 Hero / KPI / 环形占比 / 子库卡片 / 更新热力 / 入口。

可选增强（非必需，可不提或一句带过）：`Style Settings`（主题变量微调）、`Iconize`（给子库文件夹加图标）。

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 目标目录已有 `首页.md` | 不覆盖，告知用户已存在；若用户想换成本仪表盘，明确确认后再覆盖 |
| 子库文件夹 / 入口文件已存在 | 跳过该件，继续铺其余；结尾汇总「新建 X 件、跳过 Y 件」 |
| `.obsidian/` 不存在 | 照铺文件，提示用户初次用 Obsidian「Open folder as vault」打开本目录后插件才可装 |
| Homepage 插件目录不存在 | 不写 `data.json`，转步骤 5 引导先装插件 |
| 用户只想要首页、不要子库 | 允许，但提醒空库首页多为 0，观感差；建议至少留 1~2 个子库 |

## 交付话术

结尾用简短清单回报：新建了哪些文件 / 跳过了哪些、Homepage 配置是否写入、以及步骤 5 的手动清单。别把首页那段 dataviewjs 贴回给用户——它已在文件里。
