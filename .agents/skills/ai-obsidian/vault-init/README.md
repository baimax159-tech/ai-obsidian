# vault-init — Obsidian 顶级仓库初始化

一次性把「全动态聚合仪表盘首页 + 子库骨架 + Inbox + 入口文件 + Homepage 配置」铺到一个 Obsidian 仓库，让空库一打开就有可用首页，而不是白屏或一堆 0。

## 触发方式

```
/ai-obsidian:vault-init
```

或直接说："初始化 Obsidian 仓库"、"给我的笔记库搭个聚合首页 / dashboard"、"新建一个 Obsidian 库骨架"。

## 产出

| 产物 | 说明 |
|------|------|
| `首页.md` | 全动态聚合仪表盘（Hero / KPI / 环形占比 / 近12周趋势 / 子库卡片 / 更新热力 / 最近更新 / 篇幅 Top5 / 入口）。逐字复制，纯文件系统驱动，零 frontmatter 依赖 |
| `Inbox/` | 收件箱，首页单独统计「待整理」，不计入子库占比 |
| `<子库>/` × 2~4 | 顶层文件夹即子库，首页按名称排序、按数量自适应配色 |
| `<子库>/<子库>.md` | 每个子库的 folder note 入口（带 `hub` 标签），首页「子库入口」跳转目标 |
| `.obsidian/plugins/homepage/data.json` | Homepage 配置（仅当插件已装时写入），启动自动打开首页 |

## 工作原理

首页仪表盘不靠配置文件，靠**目录约定**运作：

- **顶层文件夹即子库** —— 想进统计就放进任意顶层文件夹（`.` 开头、`Inbox`、附件目录自动排除）。
- **入口靠同名 folder note 或 hub 标签** —— 三级兜底：同名笔记 → 含 `moc`/`hub`/`index`/`看板`/`首页`/`dashboard` 标签 → 篇幅最大。
- **时间全取 `file.mtime`** —— 趋势、热力、最近更新都基于文件修改时间，无需任何日期字段。
- **仓库名即品牌名** —— Hero 标题自动取 `app.vault.getName()`，改库名即改标题。

## 必做手动项（Claude 点不动，需你手动）

首页是一段 `dataviewjs`，缺插件或没开 JS 查询会整页白屏：

1. **装社区插件**：`Dataview`（必需）、`Homepage`（必需），各自 Enable。
2. **开 Dataview 的 JS 查询**：设置 → Dataview → **Enable JavaScript Queries = 开**。
3. **指 Homepage 到首页**：设置 → Homepage → 首页指向 `首页`，勾 Open on startup（若初始化时插件未装，装完可让 Claude 补写 `data.json`）。
4. **重启 Obsidian** 验证首页自动打开并渲染。

可选增强：`Style Settings`（主题微调）、`Iconize`（子库文件夹图标）。

## 幂等

已存在的 `首页.md` / 子库 / 入口文件 / `Inbox/` 一律跳过不覆盖，可安全对已有库增量补齐。