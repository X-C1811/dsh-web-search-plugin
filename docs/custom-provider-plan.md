# 自定义搜索供应商（Custom Providers）实现方案

> 调研阶段结论：支持「多个自定义 web-search 供应商 + 增删查改（CRUD）」，按 **A1 通用 REST 搜索后端** + **本机 settings 持久化 + 本机凭据域存密钥** 落地。本文档是可拍板的实施方案，确认后再进入代码实现。

---

## 1. 目标概述

在现有 `dsh-web-search-plugin`（唯一 seam id `dsh-web-search`，内部按 `provider` 分发）基础上，新增**用户自定义搜索供应商**能力：

- 支持**多个**自定义供应商（增删查改 CRUD）。
- 每个自定义供应商由用户指定：**命名（name）、凭据引用名（apiKeyEnv）、接口地址（baseURL）、API key**。
- **允许"先建占位、后补 key"**：name / apiKeyEnv / baseURL 应有值即可把条目存进列表；API key 允许暂缺——该条可存在、可改、可删，但**不可选/不可用**（`available()` false，搜索报 `WEB_PROVIDER_CREDENTIAL_MISSING`）。
- 只有 name / apiKeyEnv / baseURL 齐全**且** key 可解析时，该条才可被选为生效项。
- 保存后**立即生效**（沿用现有 `resolveOptions` 每次 search 实时读取 live settings 的机制）。
- 自定义条目出现在「搜索引擎」下拉框的可选项中。
- **全部本地化**：列表落本机 `$DSH_HOME` profile settings，密钥走本机凭据域，不上传云端、不跨 profile/机器自动同步。

---

## 2. 架构设计

### 2.1 后端模型（A1：通用 REST 搜索后端）

新增一个 `CustomSearchProvider`（通用后端类），复用现有 Tavily 后端的骨架，把三处参数化：

| 参数 | 来源 | 说明 |
|---|---|---|
| `apiKeyEnv` | 该条自定义供应商的凭据引用名 | 经 `resolveSecret` 解析（字面量 → 凭据域 → launch env → process.env） |
| `baseURL` | 该条自定义供应商的接口地址 | 请求端点 |
| `name` / `id` | 该条自定义供应商 | 展示名 / 内部稳定主键 |
| `auth` | 鉴权方式模板 | `bearer`（默认）/ `header`（自定义头）/ `none` |
| `authHeader` | 自定义鉴权头名 | 仅 `auth: header` 时使用（如 `X-Subscription-Token`） |
| `response` | 响应形态模板 | `tavily`（默认）/ `brave` / `exa` |
| `maxResults` 等 | 插件全局设置 | 复用现有 MaxResults 等 |

**协议范围（调研后收敛为选项 1）**：主流 web-search 分三类——① 纯 REST 搜索 API（Tavily `POST /search`+Bearer、Brave `GET /web/search`+`X-Subscription-Token`、Exa 裸结果数组、Perplexity 引文答案等）；② 模型自带搜索工具（DeepSeek 官方走 Anthropic Messages `web_search_20250305`、OpenAI 走 Responses API —— 这是 LLM 调用不是 REST 搜索，且 `deepseek-official` 已内置）；③ MCP（复杂度高，排除）。**自定义供应商本次只支持第①类 REST**，通过"鉴权方式模板 + 响应形态模板"覆盖大多数 Tavily 风格 / 自建网关端点；第②类（模型工具型）作为后续扩展，不入本次基线。

- 鉴权方式模板：`bearer`（`Authorization: Bearer <key>`，默认）/ `header`（把 key 放到用户指定的请求头，如 `X-Subscription-Token`）/ `none`（无鉴权，key 无需也可选）。
- 响应形态模板：`tavily`（`{results:[{url,title,content,published_date}]}` + 可选 `answer`，默认）/ `brave`（`{web:{results:[...]}}`）/ `exa`（裸 `results` 数组，`url/title` 为主、无内联答案）。

> 若后续需要覆盖第②类或更复杂的字段映射，作为独立扩展，不入本次基线。

### 2.2 可用后端集合

```
可用后端 = [tavily, brave, deepseek-official]  +  遍历 customProviders[] 中每条生成的 CustomSearchProvider 实例
```

`PluginSearchProvider.backend()` 从三分支改为：内置三分支优先；`provider` 若指向某个自定义 id，则路由到对应的 `CustomSearchProvider` 实例。

### 2.3 内部 id（稳定主键）

- 每条自定义供应商持有一个**内部稳定 id**（如 `custom-<短随机串>`），生成一次不再变。
- 显示名 `name` 可随意改。
- id 必须：唯一；不能与内置 `tavily` / `brave` / `deepseek-official` 冲突。
- 理由：provider id 是已保存会话的引用键，改了会导致旧会话挂着旧 id（DSH 官方 + 本 README 都强调过）。

---

## 3. 落库形态

### 3.1 设置命名空间

在现有 `dsh-web-search-plugin` 设置段内新增数组字段（schemastery `z.array(z.object(...))`，机制已验证可用，且内置 `role('secret')` 在数组项内同样被 redact 处理）：

```jsonc
{
  "provider": "tavily",            // 现有：当前生效（可为自定义 id）
  "customProviders": [             // 新增：多条自定义
    {
      "id": "custom-a1b2c3",
      "name": "我的自建搜索",
      "apiKeyEnv": "MY_CUSTOM_KEY",  // 凭据引用名（key 本身不落这里）
      "baseURL": "https://my-gateway.example.com"
    }
    // ... 更多条
  ]
}
```

### 3.2 密钥存储

- `apiKeyEnv` 只是**引用名**，落 settings。
- 真正的 API key 通过现有 `api.credentials.set({ ref: apiKeyEnv, value })` 写入**本机凭据域**，不回显、不落 settings 文件。
- 搜索时经 `resolveSecret` / `resolveApiKey` 解析；解析不到时 `available()` = false，`search()` 抛 `WEB_PROVIDER_CREDENTIAL_MISSING`。

### 3.3 本地化边界

- 列表 + 引用名 + baseURL 落本机 `$DSH_HOME` profile settings（`settings.yaml`）。
- 密钥落本机凭据域。
- 不跨 profile / 不跨机器同步（本地化默认即如此）。

---

## 4. CRUD 与 UI 设计

### 4.1 两个 UI 层（职责分离）

1. **管理列表层**（新增页面区块）：像「通讯录」一样列出所有自定义供应商；每条可**增 / 删 / 改 / 查**。
   - 新增：表单 name / apiKeyEnv / baseURL 应有值即允许保存该条（占位）；API key 暂缺不影响占位入库。
   - 编辑：载入该条现有值，改后保存（id 不变）。
   - 删除：按内部 id 移除；若删的是当前生效项，`provider` **自动回退到 `deepseek-official`**（官方默认，而非 tavily）。
   - 每条可独立校验：**A 条不全不影响 B 条保存**。

2. **选择层**（现有「搜索引擎」下拉框扩展）：选项 = 内置 3 个 + 所有自定义条目 name；单选一个作为当前生效 `provider`（沿用现有实时生效机制）。删除的条目从下拉消失。

### 4.2 客户端改点（`lib/client.js`）

- 下拉框 option 从硬编码 3 个 → 内置 + 动态读 `customProviders[]`（`name` 显示，`id` 为值）。
- 新增管理列表 UI 组件 + staged 表单对数组的编辑（数组项需要专门处理：编辑单条 = 按 id 替换整条对象落库）。
- 必填校验：name / apiKeyEnv / baseURL 应有值才可保存该条；未配 key 的条目允许占位保存（不可选）。
- 删除当前生效项时 `provider` 回退到 `deepseek-official`。
- 密钥写入沿用现有 `credentials.set` 路径。

### 4.3 需要新增/调整的文件

| 文件 | 动作 | 内容 |
|---|---|---|
| `lib/index.js` | 改 | `Config` 加 `customProviders[]`；`backend()` 三分支 → 内置 + 遍历自定义；新增选项resolve |
| `lib/custom.js` | **新增** | `CustomSearchProvider` 通用后端类 + resolve 函数（复用 shared/tavily 模式） |
| `lib/client.js` | 改 | 下拉动态化 + 管理列表 CRUD UI + 必填校验 |
| `README.md` | 改 | 文档说明 + 配置表新增 customProviders |

---

## 5. 边界与需要拍板的点

1. **删除当前生效项**：`provider` **自动回退到 `deepseek-official`**（官方默认，而非 tavily），避免指向不存在的 id 导致 `WEB_PROVIDER_CONFIGURED_MISSING`；回退到官方默认比退回 keyless 的 tavily 更符合"回到主流程"直觉。
2. **编辑某条时已保存的会话**：内部 id 不变则不受影响；改名只影响下拉显示。
3. **id 冲突 / 与内置同名**：新增时校验并拒绝。
4. **未配 key 的条目**：允许"先建占位、后补 key"——可存在可改可删；name / apiKeyEnv / baseURL 齐全且 key 可解析才可被选中（`available()` false）。
5. **请求形态固定为 A1**：如后续需要字段映射，作为独立扩展，不入本次基线。

---

## 6. 验收标准

- [ ] 可新增多条自定义供应商；name / apiKeyEnv / baseURL 有值即可保存该条（key 可占位留空）。
- [ ] 下拉框出现所有自定义条目（name），可选并立即生效。
- [ ] 编辑 / 删除自定义条目生效；删除当前生效项后 `provider` 自动回退到 `deepseek-official`。
- [ ] 列表 + 引用名 + baseURL 落本机 settings；密钥进本机凭据域、不回显。
- [ ] 未配 key 的条目在列表中存在、可改可删，但不可选；若被选到，搜索报 `WEB_PROVIDER_CREDENTIAL_MISSING`。
- [ ] 重启 DSH 后自定义供应商仍在（持久化生效）。
