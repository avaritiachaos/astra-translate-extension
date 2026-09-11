# 漫画 Gemini 推理参数：主源核实

**结论：保留 `gemini-3.8-flash-high` 原名，优先提供可回退的 `reasoning_effort: "low"`；默认则省略该字段。不要把 `minimal` 或 `none` 标成这个路由的“关闭推理”，也不要通过删掉 `-high` 猜模型名。** CPA 的括号推理后缀、别名目标和后续 payload 规则可能盖过请求参数，是否实际生效仍需分层验证。

- 抓取日期：**2026-09-11（Asia/Shanghai）**。仅核实 Google 官方页面、CPA 官方帮助及 GitHub 第一方源码；未调用模型。
- CPA 主快照：[main@09a29bd345bc44c473abe7fd07859e32df2ea543][commit]（提交日期 2026-09-10）；对照 [v6.9.36@f1ba6151a99240902bcda12102c921b0ead01d2d][v6]。**它们都不等于已核实的本机运行版本。** 下文源码结论默认针对主快照。

## 1. Google 官方事实：不能直接等同于 CPA 路由

[Thinking 文档][google-thinking]（页面更新 2026-09-09）当前确有以下表格行：

> `gemini-3.8-flash | On (medium) | low, medium, high`

这是该页 **Interactions API** 的官方条目；示例用 `generation_config: {"thinking_level": "low"}`。该行未列 `minimal`。它**不能证明**用户的 `gemini-3.8-flash-high` 映射到同一个 Google API 型号，更不能证明去掉 `-high` 后 CPA 能路由。

[OpenAI compatibility 的 Thinking 小节][google-openai]（页面更新 2026-09-02）给出的事实：

| 意图 | 官方兼容接口表达与适用边界 |
| --- | --- |
| 低 | 顶层 `reasoning_effort: "low"`；页面直接给出 `model: "gemini-3.8-flash"` 搭配 `low` 的示例。 |
| minimal | 不是通用“关闭”：兼容表将 Gemini 3.1 Pro 的 `minimal` 映射为 `low`，Gemini 3 Flash 列映射为 `minimal`，Gemini 2.5 列映射为 **1024** token。该兼容表没有单列 3.8 的映射，不应扩写成所有 Flash 都支持 minimal。 |
| 关闭 | 摘录：`Reasoning cannot be turned off for Gemini 2.5 Pro or 3 models.` 文档允许可关闭的 2.5 型号使用 `reasoning_effort: "none"`，但明确排除 2.5 Pro 和 Gemini 3。 |
| 默认 | 摘录：`If no reasoning_effort is specified, Gemini uses the model's default level or budget.` 即**不发送字段**，不是发送 `"default"`，也不是强行改成 `"auto"`。 |

同页允许用原始 JSON 的 `extra_body.google.thinking_config` 表达 Gemini 参数，但明确说 `reasoning_effort` 与 `thinking_level/thinking_budget` **不能同时用**。`include_thoughts` 控制思考摘要输出，不是关闭内部推理。最小改动无需混入这些原生字段。[官方示例与说明][google-openai]

## 2. CPA 源码事实与有条件的转换结果

### 已有该 ID 的第一方证据，但不是本机证明

主快照的 [Antigravity 内置能力条目][catalog] 明确包含：

```json
{"id":"gemini-3.8-flash-high","thinking":{"min":1,"max":65535,"dynamic_allowed":true,"levels":["low","medium","high"]}}
```

上面是该条目的相关字段摘录，未开启 `zero_allowed`。**这是 CPA 能力声明，不是 Google 官方支持表，也不是本机模型清单。** 对照的 [v6.9.36 内置目录][catalog-v6] 没有这个 ID；但 [模型更新器][updater] 会从内置数据启动、再刷新远程目录，因此“旧目录没有”也不能证明用户当前不可用。

[OpenAI→Antigravity 翻译器][translator] 读取 `reasoning_effort`，将普通级别写入 `request.generationConfig.thinkingConfig.thinkingLevel`；`auto` 写 `thinkingBudget=-1`。源码摘录：`Base envelope (no default thinkingConfig)`、`SetBytes(out, thinkingPath+".thinkingLevel", effort)`。随后还有能力校验，不能只看这一层便宣称成功。

**条件：加载上述能力条目、走 OpenAI Chat Completions→antigravity，且没有下节的覆盖规则。** 按 [ValidateConfig][validator] 和 [Antigravity applier][applier] 静态推导：

| 请求 | 该源码路径的归一化结果 | 不应宣称 |
| --- | --- | --- |
| `low` | `thinkingLevel: "low"` | 已经实测本机低推理生效 |
| `minimal` | 跨提供商协议转换会把不支持的级别夹取到最近支持项，这里是 `low` | 比 low 更低，或关闭 |
| `none` | 进入 `ModeNone`；零预算被夹至最小值 1，级别回落到首个支持项 `low`，最终走 level 写入 | 真正无推理、零思考 token |
| 不传 | 不主动注入思考量；由模型、别名及配置决定 | 本机必定采用 Google 页面中的 medium |

关键源码摘录：`allowClampUnsupported`、`ModeNone for a model that cannot be disabled falls back to the lowest supported level`。若模型未知/用户自定义，统一处理层可**跳过能力校验交给上游**；若已知模型不支持 thinking，则可剥掉相关配置。上述表格不能外推到这两种情况。[统一处理层][apply]

官方 [括号后缀帮助页][help] 也注明 `none` 的零预算在不允许零时会夹至最小值。它对“不支持级别返回 400”的概述不覆盖上述跨协议夹取分支，应以具体版本源码为准。帮助页的通用近似预算表也不能冒充 Google 兼容接口映射表。

## 3. `-high`、括号后缀、显式参数的优先级

1. **`-high` 本身不是 CPA 推理后缀。** [解析器][suffix] 只识别末尾括号 `model(value)`。`gemini-3.8-flash-high` 是完整 ID；并无“看见 `-high` 就覆盖 low 请求”的通用解析规则。第一方还写了保留该 ID、输入 `reasoning_effort:"medium"`、断言上游 `thinkingLevel=="medium"` 的 [mock 测试][fixture]；本次只读测试源码，**没有运行测试或调用上游**。
2. **在 thinking 处理层，括号后缀优先于 body。** 摘录：`Get config: suffix priority over body`。例如 `…-high(high)` 加 body `low`，会选括号的 `high`；`…-high(low)` 则保留完整路由 ID、表达低推理，不需要删掉 `-high`。[源码][apply]
3. **OAuth 别名目标若已自带括号，目标括号又优先于请求括号。** [主快照][alias]：`if thinking.ParseSuffix(resolved).HasSuffix { return resolved }`；[v6.9.36][alias-v6] 同样注明 `If config already has suffix, it takes priority.` 因而某别名若实际指向 `upstream(high)`，body `low`，甚至请求的 `(low)`，都不能保证胜出。未读取本机配置，不能断言用户属于此情况。
4. **上述不是全链路最高优先级。** [执行器][pipeline] 先 `ApplyRequestThinking`，再 `ApplyPayloadConfigWithRequest`。[payload 规则][payload] 的 override 可重写、filter 可删除字段；default 依据原始翻译负载是否已有字段，甚至可能再改写仅由括号注入的字段。摘录：`Apply override rules: last write wins per field`。所以必须核对最终上游负载，不能仅凭浏览器/客户端发出 low 就认定生效。

## 4. 给主线程的最小、安全实施建议

- **现在只做“默认 / 低”最小选项，保留默认以兼容现有行为。** 默认不发送 `reasoning_effort`；低只增加下面的 body 字段，保留用户模型名及现有 messages 等内容，不全局强加给其他供应商。

  ```json
  {"model":"gemini-3.8-flash-high","reasoning_effort":"low"}
  ```

- **此路由不要提供宣称有效的“关闭”。** Gemini 3 / 未确认能力的模型应禁用该选项并解释原因；只有未来已确认可关闭的具体模型，才考虑用 `none`。不要把 `none→low`、`minimal` 或隐藏摘要伪装成关闭。此处也没有必要新增一个实际仍归一到 low 的 minimal 档。
- **不自动改名、不自动加括号、不同时塞两套 thinking 参数。** 高级用户若明确要 CPA 后缀，可在验证别名目标后使用完整 ID 加 `(low)`；不要作为无条件兼容修复。明确参数不支持时提供“恢复默认”，不要对任意错误静默重发模型请求。

### 如何验证（本次未做在线验证）

1. **离线请求测试：** mock 请求构造器，断言默认没有 effort 字段、低恰为 `low`、模型字符串原样保留、关闭不会被误发；不连接本机 CPA。
2. **代理转换验证：** 用与实际版本/能力匹配的纯转换 fixture 或 mock 上游检查最终 `model` 和 `request.generationConfig.thinkingConfig`；上述第一方测试是方法示例，不是本机验收。最终为 `thinkingLevel:"low"` 且没有冲突预算，只证明参数已按预期传递。
3. **真正上游效果需另行授权或由用户自行验证：** 比较默认/low 的同一输入、多次延时、完整输出与上游思考 token 统计（若提供）；只接收必要且脱敏的结果，不索要凭证。**HTTP 200、一次变快、没有思考摘要，都不足以证明关闭或严格遵守某一档位。**

## 5. 本机未核实与任务边界

未核实：实际 CPA 版本/构建、运行时模型能力、别名目标、payload 规则及其他改写、该 ID 的真实上游映射、Google Antigravity 是否最终接受/遵守设置。未访问 `localhost:8317` 或其他本机 CPA 接口；未读 `config.yaml`、账号/token、用户浏览器；未发模型请求、安装依赖或下载仓库。除先前指定 README 外，仅做主源读取；**本任务唯一写入文件就是本文，未修改悬浮球、漫画翻页取消或任何实现。**

[google-thinking]: https://ai.google.dev/gemini-api/docs/thinking#thinking-levels
[google-openai]: https://ai.google.dev/gemini-api/docs/openai#thinking
[help]: https://help.router-for.me/configuration/thinking.html
[commit]: https://github.com/router-for-me/CLIProxyAPI/commit/09a29bd345bc44c473abe7fd07859e32df2ea543
[v6]: https://github.com/router-for-me/CLIProxyAPI/tree/f1ba6151a99240902bcda12102c921b0ead01d2d
[catalog]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/registry/models/models.json#L3450-L3468
[catalog-v6]: https://github.com/router-for-me/CLIProxyAPI/blob/f1ba6151a99240902bcda12102c921b0ead01d2d/internal/registry/models/models.json
[updater]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/registry/model_updater.go#L17-L98
[translator]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/translator/antigravity/openai/chat-completions/antigravity_openai_request.go#L31-L60
[validator]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/thinking/validate.go#L56-L337
[applier]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/thinking/provider/antigravity/apply.go#L96-L166
[apply]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/thinking/apply.go#L220-L305
[suffix]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/thinking/suffix.go#L12-L44
[fixture]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/runtime/executor/antigravity_home_model_capabilities_test.go#L58-L99
[alias]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/sdk/cliproxy/auth/oauth_model_alias.go#L122-L134
[alias-v6]: https://github.com/router-for-me/CLIProxyAPI/blob/f1ba6151a99240902bcda12102c921b0ead01d2d/sdk/cliproxy/auth/oauth_model_alias.go#L230-L238
[pipeline]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/runtime/executor/antigravity_executor_execute.go#L86-L98
[payload]: https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/internal/runtime/executor/helps/payload_helpers.go#L65-L194
