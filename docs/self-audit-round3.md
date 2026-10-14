# Round 3 开工前自查报告（基于当前 main = 436638f）

图例：✅ 已验证；⚠️ 已实现但未在真实环境验证；❌ 有问题或未完成。本文只记录事实，Round 3 的修复还没有开始。

## 一、Round 2 的整体结论（详见 docs/self-audit-round2.md）
- **已完成**：阶段 A–D 全部发布在 v1.0.1，Linux 和 Windows CI 的 E2E 都通过。
- **未在真实环境验证（⚠️）**：
  - 真实厂商 API（只用了本地模拟服务器）；
  - 真实麦克风和转写服务；
  - macOS 的标题栏和麦克风授权；
  - Windows 截图（不含系统绘制的窗口按钮）。
- **用户实测后发现、我之前没有发现的问题（❌，即 Round 3 A 类）**：
  - **窗口最大化溢出屏幕（A2）**：E2E 只检查了标题栏颜色和拖动区域，没有检查最大化后的窗口边界是否等于工作区。
  - **深度思考 / 工具 / 联网搜索默认开启，且没有提示（A3）**。
  - **没有搜索密钥时仍能开启联网搜索，每条回复前都有橙色警告（A4）**。
  - **claude-sonnet-5-5 首条消息返回 400（A5）**：模拟服务器没有校验 Anthropic 的参数约束，所以测试没能发现。
  - **渲染进程能拿到明文密钥（A6）**：密钥在存储层是加密的，但会被解密后交给渲染进程，界面上也能用“眼睛”按钮查看。CodeQL 告警 #4 也指向这里，见第四节。

## 二、A1：CI #14（5b73616）Windows 失败的证据
- **运行信息**：run 38543870948，第 14 次运行，提交 5b73616，conclusion = failure。
- **工件**：已用 `gh run download 38543870948 -n e2e-report-windows` 下载 e2e-report-windows（artifact id 11883104180），其中包含 playwright-report、test-results、screenshots。
- **结果**：71 passed、1 skipped、**1 failed**。唯一失败的测试是 `e2e\r2b.spec.ts:169` “reading width: narrow / standard / wide; actions shown on hover”，第一次运行和 retry1 都失败了，各有一份 error-context.md 和 failure.png。
- **错误信息**：`expect(received).toBeGreaterThan(expected)  Expected: > 760  Received: 760`
- **原因**：
  - failure.png 显示 Windows runner 的窗口只有约 1024×720，消息区可用宽度只有约 760 px。
  - 因此“标准”（max-width 980px）和“宽”（max-width 1280px）都被可用宽度截断成 760 px，测试断言“宽 > 标准”不成立。
  - 这是测试依赖了 CI 屏幕尺寸，不是阅读宽度功能本身坏了。
- **修复**：提交 2bc8e40 “e2e: make reading-width test independent of CI screen work area”。改动如下：
  - 先把窗口设为 1700×1000；
  - 直接断言计算后的 max-width 依次为 720 / 980 / 1280 px；
  - 只有可用宽度大于 1000 px 时才要求“宽”的实际宽度大于“标准”，否则只要求大于等于。
- **修复后的验证**：2bc8e40 的 CI 运行 38544621225（第 15 次）结果为 success。之后 main 上每次合并后的 CI 都是绿色，例如 9af291f 的 Windows 结果为 95 passed、1 skipped。
- **如实说明**：这个修复放宽了小屏幕下的断言。在约 1024 px 宽的 Windows runner 上，“宽 > 标准”实际上没有被测试，只测试了 CSS 的 max-width。
- **相关问题**：runner 工作区很小，也说明窗口尺寸和工作区相关的行为（A2 最大化溢出）需要专门检查 bounds == workArea。

## 三、Dependabot PR 处理情况（共 11 个）
| PR | 内容 | 结果 | 说明 |
|---|---|---|---|
| #5 | github/codeql-action v4 | ✅ 已合并 f33d0ee | 只改工作流 |
| #4 | softprops/action-gh-release v3.0.3 | ✅ 已合并 6688b75 | 改用 Node 24 运行时 |
| #3 | actions/upload-artifact v7 | ✅ 已合并 c824f69 | Node 24 |
| #2 | actions/checkout v7 | ✅ 已合并 2dd364e | Node 24 |
| #1 | actions/setup-node v7 | ✅ 已合并 981c2bd | 与 main 冲突，在 main 上重新应用了同样的版本升级 |
| #6 | 构建/测试工具组（vite 8、vitest 5、TypeScript 7.0.2、@types/node 26、plugin-react 6） | ✅ 已合并 9af291f | 本地 174 个单元测试 + 96 个 E2E 通过；重新生成了 THIRD_PARTY_NOTICES |
| #8 | react-markdown 10 | ✅ 已合并 d3673c0 | 在 main 上重新生成了 lock；代码没有用到被移除的 className，不需要改代码 |
| #9 | pdfjs-dist 6.4.299 | ✅ 已合并 436638f | 新增 tests/fixtures/sample.pdf（2 页），以及 E2E “attachments: PDF text extraction”，验证所有页的文字都能提取。本地 174 个单元测试 + 97 个 E2E 通过；PR 上的 Windows、CodeQL、npm-audit 都通过 |
| #7 | mermaid 12.1.0 | ⏸ 保持打开，已留言 | 新捆绑了 elkjs@0.9.3（EPL-2.0，弱 copyleft），与“只用宽松许可依赖”的策略冲突；默认布局改为 ELK，默认外观改为 neo，要保持现有外观需要显式设置 `layout:'dagre', look:'classic'`。**需要用户决定是否接受 EPL-2.0** |
| #10 | react-dom 19 | ⏸ 保持打开，已留言 | 单独升级会让 CI 失败，必须和 #11 一起升级 |
| #11 | react 19 + @types/react | ⏸ 保持打开，已留言 | 同上；因为接到停止指令，本轮没有处理 |

- 用户看到的“5 个 PR”是当时的数量，之后 Dependabot 又陆续打开了其余的 PR。
- 目前仍打开的 PR：**#7、#10、#11**。
- 所有 action 都已升级到 Node 24 版本。Node 20 弃用警告是否已全部消失，要在 A1 中逐条检查 annotations 后才能确认，目前未逐条核对。

## 四、Code scanning 告警（2026-10-14 查询）
已修复：#1 actions/unpinned-tag（工作流中的 action 已固定版本，状态为 fixed）。

仍打开的 4 个告警（即用户看到的 4 个）：
| # | 规则 | 位置 | 分析 | 建议处理 |
|---|---|---|---|---|
| 5 | js/remote-property-injection（high） | tests/mock-server.mjs:86 | 只是测试用的模拟服务器：解析 multipart 时用请求里的字段名写入 `fields[m[1]]`，理论上可以写 `__proto__`。不会打包进应用，只在本机测试时运行 | 改用 `Object.create(null)` 或 Map 修掉（代价很小），不要直接 dismiss |
| 2 | js/polynomial-redos（high） | tests/mock-server.mjs:81 | 同一个测试文件中的 `/boundary=(.+)$/` 和 multipart 正则，输入来自本机测试 | 改写正则，或改用 split/indexOf 来修掉 |
| 4 | js/clear-text-storage-of-sensitive-data（high） | src/renderer/api.ts:9 | 浏览器回退分支（没有 Electron、只在 vite dev 中使用）用 localStorage 明文存配置（含密钥）。打包后的应用不会走这个分支，但它说明渲染进程会接触到密钥 | 与 A6 一起修：渲染进程不再持有明文密钥；浏览器回退分支不再保存密钥字段 |
| 3 | js/insecure-randomness（high） | src/renderer/App.tsx:151（提交 d3673c0） | `lastUser.id` 来自 `uid()`（src/shared/storage.ts:19，Math.random），只用作消息 ID，并不用于安全用途。CodeQL 认为它进入了“安全上下文”，可能因为它流入了请求 | 改用 `crypto.randomUUID()`（成本低）消除告警；同时把 stt.ts 中 multipart boundary 的生成也改用 crypto |

## 五、npm audit（main 436638f）
- **结果**：0 critical、0 high、**10 moderate**，全部来自 sprintf-js（GHSA-hp3w-g68c-fv3c，DoS）。
- **来源**：
  - mammoth → argparse 1.0.x（运行时依赖，docx 解析，传入的是用户自己选择的文件）；
  - electron-builder → app-builder-lib → @electron/get → global-agent → roarr（只在打包时使用）。
- **为什么没有修**：`npm audit fix --force` 会把 mammoth 降级到 0.3.29，属于破坏性改动，所以没有执行。
- **建议**：等上游更新；或者评估用 overrides 把 sprintf-js 固定到已修复的版本（如果有的话），并测试 docx 解析。

## 六、其他
- 仓库的 Private vulnerability reporting 仍是**关闭**状态（API 返回 enabled=false），建议在仓库设置中打开（需要仓库所有者操作）。
- 从本报告开始遵守新流程：所有改动走分支 + PR，不直接提交到 main；CI 是红色时不推送；CI 全绿后才发布 Release。
