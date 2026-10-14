# SQLite 存储评估 / SQLite storage evaluation

状态：**仅评估，1.0.1 未迁移**。1.0.1 继续使用 JSON 文件，但加入了原子写入、轮换备份和损坏自动恢复（见 README “数据安全”）。
Status: **evaluation only, not migrated in 1.0.1.** 1.0.1 keeps JSON files and adds atomic writes, rotating backups and automatic restore.

## 1. 现状 / Current design
- 主进程 `electron/store.ts` 管理 `userData/data/<key>.json`，key 共 8 个：settings、conversations、personas、prompts、gallery、modelCache、folders、tombstones。
- 渲染进程通过 `kv:get` / `kv:set` 读写整个值；对话列表在每次变化后（400 ms 防抖）**整体重写** `conversations.json`。
- 设置中的密钥字段先用 safeStorage 加密再落盘；WebDAV 同步按对话 id + `updatedAt` + tombstones 合并整份 JSON。
- 1.0.1 起：写临时文件 → fsync → rename；启动时和每 10 分钟（内容有变化时）备份，每个 key 保留 5 份；解析失败或顶层类型不对时保留损坏文件并从最新有效备份恢复。

## 2. 对比 / Comparison

| | JSON 文件（现状 + 1.0.1 加固） | SQLite（better-sqlite3 / node:sqlite） |
|---|---|---|
| 写入成本 | 每次保存重写整个 conversations.json：1 万条消息约几 MB，写入是 O(总大小) | 只写改动的行，O(改动) |
| 崩溃安全 | 原子 rename：要么旧文件要么新文件；最多丢失最后 400 ms 防抖内的修改 | WAL 事务，单条消息级别的持久化 |
| 损坏恢复 | 1.0.1：整文件回退到最近备份（可能丢失最多 10 分钟的修改） | `PRAGMA integrity_check`，`.recover`；损坏通常局限于部分页面 |
| 读取 / 搜索 | 启动时整份读入内存；搜索在渲染进程线性扫描 | 按需分页加载；FTS5 全文搜索（中文需要分词器，如 trigram 或 ICU） |
| 内存 | 与数据总量成正比 | 只加载当前对话 |
| 同步（WebDAV） | 直接序列化整份 JSON，简单 | 需要导出 / 导入层，复杂度增加 |
| 备份与导出 | 直接复制 JSON，人可读 | 需要 `VACUUM INTO` 或在线备份 API；导出仍需 JSON |
| 打包 | 无原生依赖 | better-sqlite3 是原生模块：每次升级 Electron 都要按 Electron ABI 重新编译（electron-builder 的 install-app-deps / prebuild），CI 需要 Windows 构建；`node:sqlite`（Node 22.5+）在 Electron 中仍为实验性质，API 可能变化 |
| 安装包体积 | 0 | 约 +2–3 MB（better-sqlite3 + SQLite） |
| 许可证 | — | SQLite 公有领域；better-sqlite3 MIT |
| 测试 | 现有 174 个单元测试 + E2E 直接读写 JSON 种子数据 | 需要改写测试种子与断言 |

结论：对目前的数据规模（个人使用，几百到几千个对话），JSON + 1.0.1 加固在可靠性上已经足够；SQLite 的主要收益在**大数据量下的写入成本、内存占用和全文搜索**。建议在出现以下任一情况时再迁移：单个 conversations.json 超过约 20 MB、保存时出现可感知的卡顿、或要做服务端级别的全文搜索。

## 3. 迁移方案（如果将来要做）/ Migration plan
1. **抽象层**：主进程引入 `StorageBackend` 接口（get/set/list/patch），JSON 实现即现有 `JsonStore`；渲染进程的 `kv:get/kv:set` 不变，新增按对话粒度的 `conv:list / conv:get / conv:put / conv:delete`，渲染进程逐步改为增量保存。
2. **表结构**：`conversations(id PK, title, folder_id, pinned, provider_id, model, system_prompt, tags JSON, created_at, updated_at)`、`messages(id PK, conv_id FK, parent_id, branch_idx, role, content, reasoning, attachments JSON, usage JSON, citations JSON, created_at)`、`kv(key PK, value JSON)` 存 settings 等小对象（密钥仍为 safeStorage 密文）、`tombstones(id PK, deleted_at)`；`PRAGMA journal_mode=WAL; synchronous=NORMAL; foreign_keys=ON; user_version=<schema>`。
3. **一次性迁移**：首次启动新版本时，若存在 `data/*.json` 且没有 `tidequill.db`：先做一份完整 JSON 备份到 `backups/pre-sqlite-<时间>/`，在**单个事务**中导入，导入后逐条比对数量和 id，成功才写 `user_version` 并把 JSON 文件改名为 `*.migrated.json`（保留，不删除）；失败则回滚、继续使用 JSON，并提示用户。
4. **回退**：保留“导出全部为 JSON”的功能；降级到旧版本时，旧版本仍能读取保留的 JSON（只是缺少迁移后的新数据），在发布说明中写明。
5. **WebDAV / 备份**：同步与备份继续使用 JSON 导出格式，与数据库内部结构解耦。
6. **测试**：迁移单元测试（含损坏 JSON、空数据、10 万条消息的性能测试）、E2E（旧数据 → 新版本启动 → 内容一致），Windows CI 上验证原生模块加载。

## 4. 风险 / Risks
- **原生模块**：Electron 每次大版本升级（1.0.1 已从 31 升到 44）都要重新编译 better-sqlite3；预编译包缺失时 Windows 构建会失败。这是最大的长期维护成本。
- **数据丢失风险集中在迁移那一次**：必须有迁移前完整备份和严格校验，且不能删除原 JSON。
- **并发**：只有主进程访问数据库，避免多进程写；但便携版若同时启动两个实例需要单实例锁（已有窗口复用逻辑之外需再确认）。
- **文件锁 / 杀毒软件**：Windows 上 WAL 文件和 `-shm` 可能被杀毒软件或同步盘（OneDrive）锁住或损坏；JSON 原子 rename 也受影响，但影响面更小。数据目录在 `%APPDATA%`，一般不在同步盘中。
- **中文全文搜索**：FTS5 默认分词器不切分中文，需要 trigram（≥3 字）或自带分词，体验需要专门测试。
- **工作量**：渲染进程目前假设所有对话都在内存中（侧边栏搜索、分支、对比、导出），改为按需加载涉及大部分界面代码。
