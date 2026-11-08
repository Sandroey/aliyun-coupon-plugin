# 阿里云代金券余额 · DSH 插件

[![Release](https://img.shields.io/github/v/release/Sandroey/aliyun-coupon-plugin?label=release&color=2ea44f)](https://github.com/Sandroey/aliyun-coupon-plugin/releases/latest)
[![Repo](https://img.shields.io/badge/repo-Sandroey%2Faliyun--coupon--plugin-181717?logo=github)](https://github.com/Sandroey/aliyun-coupon-plugin)

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（简称 DSH）的 Web 界面里，**常驻显示阿里云代金券（现金券）的可用余额和今日变化**，支持多个阿里云账号同时查看。

> 数据来自阿里云 BSS OpenAPI 的 `QueryCashCoupons`，凭据只保存在本机，前端永远拿不到 AccessKey Secret。

---

## 目录

- [它能做什么](#它能做什么)
- [界面长什么样](#界面长什么样)
- [工作原理](#工作原理)
- [环境要求](#环境要求)
- [安装](#安装)
- [获取 AccessKey（关键一步）](#获取-accesskey关键一步)
- [添加账号](#添加账号)
- [日常使用](#日常使用)
- [数据与隐私](#数据与隐私)
- [本地接口](#本地接口)
- [排错](#排错)
- [已知限制](#已知限制)
- [目录结构](#目录结构)
- [开发与调试](#开发与调试)
- [版本历史](#版本历史)

---

## 它能做什么

| 能力 | 说明 |
|---|---|
| 侧边栏常驻卡片 | 显示全部账号的**合计可用余额**和**今日增减**；多账号时标签变成 `代金券·N`；侧边栏折叠时退化为图标 |
| 详情面板 | 每个账号一张卡片：余额、今日变化、余额曲线、逐张券明细（余额/面额/到期日/适用产品）、7 天内到期提醒、独立错误信息 |
| 多账号管理 | 添加 / 编辑 / 移除账号，最多 20 个；保存前会**先真实调用一次接口验证**，失败当场告诉你原因 |
| 自动刷新 | 宿主侧每 N 分钟（默认 10，可设 1–240）并发刷新所有账号；页面每 30 秒读一次缓存 |
| 历史采样 | 按账号分别落盘，重启 DSH 后曲线仍在，可看出余额是在什么时候掉的 |
| Agent 工具 | 注册了 `aliyun_coupon_balance`，可以直接问「我的代金券还剩多少」，也能指定某个账号 |
| 安全 | 凭据仅落本机文件（0600）；接口只回传打码后的 AccessKeyId；HTTP 路由只接受本机同源请求 |

## 界面长什么样

侧边栏底部（Settings 旁边）：

```
┌─────────────────────────┐
│  ◎ 代金券·2  ¥1,234.56  -12.30 │   ← 点击打开阿里云卡券控制台
└─────────────────────────┘
```

详情面板（左侧图标栏的票据图标进入）：

```
阿里云代金券                                     [刷新全部] [添加账户] [打开卡券控制台]
2 个账户 · 每 10 分钟刷新

┌──────────────────────────────────────────────────────────┐
│ 全部账户可用余额                                          │
│ ¥1,234.56    今日 -12.30                                 │
│ 2 个账户 · 5 张可用 · 面额合计 ¥1,500.00 · 更新于 11-08 14:01 │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ ● 主账号                 LTAI5t****AbCd      11-08 14:00  │
│                                        [编辑] [移除]      │
│ ¥1,000.00   今日 -12.30                                  │
│ 3 张可用 · 面额合计 ¥1,200.00                             │
│  ╭─────────────余额曲线─────────────╮                     │
│  券A  ¥600.00  (面额 ¥800.00)  2026-12-31 到期            │
│  券B  ¥400.00                 2026-11-15 到期            │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ 设置                                        自动刷新间隔 [10] [保存设置] │
└──────────────────────────────────────────────────────────┘
```

## 工作原理

```
DSH 宿主进程（Node）
  ├─ 每 N 分钟并发调用 BSS OpenAPI
  │    GET https://business.aliyuncs.com/?Action=QueryCashCoupons&...
  │    RPC 签名：HMAC-SHA1，SignatureVersion=1.0，按 key 排序 + RFC3986 编码
  ├─ 解析 Data.CashCoupon[]，按账号缓存快照
  ├─ 每次刷新写一条余额采样到本地（有变化或间隔 >10 分钟才写）
  └─ 暴露 3 个本机 HTTP 路由（只允许 127.0.0.1 / localhost，校验 Origin）

DSH 浏览器端
  └─ 每 30 秒 GET /aliyun-coupon/state，渲染侧栏卡片与面板
     （只拿得到打码后的 AK，Secret 从不离开宿主进程）
```

三个 UI 挂载点：

| 挂载点 | 用途 |
|---|---|
| `sidebar.footer.action` | 侧边栏底部常驻卡片 |
| `sidebar.panellist` | 左侧图标栏入口（id 与 `main` 面板 key 对应） |
| `main`（key `aliyun-coupon`） | 详情面板 |

## 环境要求

- **DSH**：桌面版或 Web 版，且 profile 能正常运行（本插件通过 `plugin_manager` 安装为本地 bundle）。
- **阿里云账号**：能登录 RAM 控制台创建用户、授予权限。
- **网络**：宿主进程能访问 `https://business.aliyuncs.com`（如需代理，给 DSH 配置 `HTTPS_PROXY`）。

## 安装

先拿到插件文件（两种方式任选其一），再让 DSH 安装该目录。

### A. 下载 Release 包（不用装 git）

打开 [Releases](https://github.com/Sandroey/aliyun-coupon-plugin/releases/latest)，下载 `aliyun-coupon-plugin-1.1.0.zip`，
解压到任意目录，例如：

```
D:\tools\aliyun-coupon-plugin-1.1.0\
```

### B. 用 git 克隆

```bash
git clone https://github.com/Sandroey/aliyun-coupon-plugin.git
```

### 安装到 DSH（两种情况通用）

对 DSH 助手说：

> 帮我安装 `D:\tools\aliyun-coupon-plugin-1.1.0` 这个 bundle

DSH 会调用 `plugin_manager install_bundle`，把包的绝对路径作为目标安装到当前 profile。
也可以直接指定工具参数：

```
plugin_manager(action="install_bundle", target="<插件目录的绝对路径>")
```

### 安装后

1. 安装结果里应看到 `application: applied`；
2. **刷新一次 DSH 页面**（客户端模块需要重新加载）；
3. 侧边栏底部出现 `代金券` 卡片，左侧图标栏出现票据图标。

> 若卡片没出现：到 设置 → 插件 里确认 `@local/aliyun-coupon` 是启用状态；必要时关闭再启用一次。

## 获取 AccessKey（关键一步）

插件调用的是**费用中心只读接口**，所以不要用主账号的 AccessKey，按下面单独建一个只读 RAM 用户：

### 1. 创建 RAM 用户

1. 登录阿里云控制台 → 搜索 **RAM 访问控制**；
2. 左侧 **身份管理 → 用户 → 创建用户**；
3. 登录名称随意（例如 `dsh-coupon-reader`）；
4. **访问方式只勾选「OpenAPI 调用访问」**（不要勾选控制台登录）；
5. 创建完成。

### 2. 只授予「费用中心只读」权限

1. 在用户列表点进刚建的用户 → **权限管理 → 新增授权**；
2. 选择 **系统策略**，搜索 `AliyunBSSReadOnlyAccess`；
3. 勾选并确认。

> 这个策略包含接口所需的权限点 `bss:DescribeCoupons`（`QueryCashCoupons` 的授权项）。
> 如果你用的是自定义策略，最小权限就是这一条。

### 3. 生成 AccessKey

1. 该用户 → **认证管理 → 创建 AccessKey**；
2. 记下 **AccessKey ID** 和 **AccessKey Secret**（Secret 只显示一次）；
3. 建议顺手给这个 AK 备注「仅 DSH 代金券插件」。

> ⚠️ 不要把 AK/Secret 提交到任何仓库、也不要发在公开聊天里。本插件只需要它读费用中心，不需要也不应该给它写权限。

## 添加账号

打开 DSH → 左侧图标栏点**票据图标** → 面板右上角 **添加账户**：

| 字段 | 说明 |
|---|---|
| 备注名称 | 例如「主账号」「海外账号」，只用于显示（不填会显示打码后的 AK） |
| AccessKey ID | 上一步生成的 ID |
| AccessKey Secret | 上一步生成的 Secret |
| 接入点 | 默认 `https://business.aliyuncs.com`，一般不用改（国际站/特殊区域可改） |

点 **保存并验证**：插件会立刻用这组凭据真实调用一次接口。

- 成功 → 账号立即出现在列表里，余额马上可见；
- 失败 → 表单下方直接显示阿里云返回的错误码 + 中文提示（见[排错](#排错)）。

有多个账号就重复这一步，每个账号填各自的 AK。同一把 AK 不能重复添加。

### 编辑 / 移除

- **编辑**：改名称、换 Secret、改接入点。AccessKey ID 留空表示"不修改"；如果换了 ID，必须同时填写新 Secret。
- **移除**：点一次进入确认态，再点一次才真正删除（防误触）。

### 环境变量兜底（可选）

在**没有任何已保存账号**时，插件会把以下环境变量当作一个只读的虚拟账号：

```bash
ALIBABA_CLOUD_ACCESS_KEY_ID=...
ALIBABA_CLOUD_ACCESS_KEY_SECRET=...
# 或者
ALIYUN_ACCESS_KEY_ID=...
ALIYUN_ACCESS_KEY_SECRET=...
```

这个账号不会写入磁盘，面板里显示「来自环境变量」，不能编辑或删除。

## 日常使用

### 侧边栏卡片

- 显示全部账号合计可用余额 + 今日合计增减；
- 鼠标悬停（或长按）能看到**逐账号**的金额明细，失败的账号会显示原因；
- 点一下直接打开阿里云卡券控制台。

### 详情面板

- 顶部：合计余额、账户数、可用券数、面额合计、最后更新时间；
- 每个账号独立卡片，**某个账号报错不会影响其他账号**（顶部会出现「部分账户读取失败」提示）；
- 到期提醒：7 天内到期的券会单独提示合计金额；
- 明细可展开/收起（默认显示前 4 张）。

### 用自然语言查余额

插件注册了 Agent 工具 `aliyun_coupon_balance`，直接问即可：

> 我的代金券还剩多少？

> 主账号的代金券还有多少？最近有减少吗？

> 有没有快过期的代金券？

工具参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `refresh` | boolean | 是否强制立即调用阿里云接口（默认用缓存，超过 30 秒会自动刷一次） |
| `account` | string | 只看某个账号，填账号名称、id 或打码后的 AK 前缀；留空返回全部 |

## 数据与隐私

凭据与历史都保存在当前用户主目录下：

```
%USERPROFILE%\.dsh\aliyun-coupon\
├── accounts.json   # 多账号凭据 + 全局刷新间隔（权限 0600）
└── history.json    # 按账号的余额采样（权限 0644，不含凭据）
```

- 浏览器端只能拿到 `LTAI5t****AbCd` 这种打码字符串，**Secret 从不下发**；
- 三个 HTTP 路由都会校验 `Host` 必须是本机，且存在 `Origin` 时必须与请求同源，避免任意网页读取余额；
- 从旧版（单账号）升级时，`credentials.json` 会自动迁移进 `accounts.json`，原文件改名为 `credentials.json.migrated`，确认无误后可自行删除；
- 卸载插件**不会**自动删除这两个文件，需要清理时手动删掉 `%USERPROFILE%\.dsh\aliyun-coupon` 目录。

## 本地接口

插件在 DSH 的 Web 服务上注册了这些路由（都只允许本机访问）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/aliyun-coupon/state` | 读取全部账号快照；单个账号超过 30 秒会自动刷新一次 |
| POST | `/aliyun-coupon/refresh` | 强制刷新全部账号 |
| POST | `/aliyun-coupon/accounts` | 新增/更新账号，body：`{"account":{"id?","name","accessKeyId","accessKeySecret","endpoint"}}` |
| POST | `/aliyun-coupon/accounts/remove` | 移除账号，body：`{"id":"<账号id>"}` |
| POST | `/aliyun-coupon/settings` | 全局设置，body：`{"intervalMinutes":10}` |
| POST | `/aliyun-coupon/config` | 旧版兼容入口（等价于"更新第一个账号"） |

`/state` 返回结构（节选）：

```jsonc
{
  "configured": true,
  "ok": true,
  "total": 1234.56,
  "deltaToday": -12.30,
  "accountCount": 2,
  "accounts": [
    {
      "id": "f53a998d",
      "name": "主账号",
      "accessKeyIdMasked": "LTAI5t****AbCd",
      "ok": true,
      "total": 1000.00,
      "count": 3,
      "deltaToday": -12.30,
      "updatedAt": 1793509174575,
      "error": null,
      "expiring": [{ "name": "券B", "balance": 400, "expiry": 1794691200000 }],
      "coupons": [ /* ... */ ],
      "history": [{ "t": 1793509174575, "total": 1000.00 }]
    }
  ]
}
```

## 排错

| 现象 | 原因 / 处理 |
|---|---|
| 卡片显示「未配置」 | 还没有添加账号，或保存失败 |
| 卡片显示「暂不可用」 | 所有账号都读取失败，展开面板能看到具体错误 |
| `InvalidAccessKeyId.NotFound` | AccessKey ID 写错，或该 AK 已被禁用/删除 |
| `SignatureDoesNotMatch` | AccessKey Secret 写错 |
| `NotApplicable` | 该账号类型不支持 `QueryCashCoupons`（部分账号不开放代金券查询） |
| `NotAuthorized` / `Forbidden.RAM` | RAM 用户缺少 `AliyunBSSReadOnlyAccess` |
| `Throttling` | 调用过于频繁，调大刷新间隔或稍后再试 |
| `TIMEOUT` / `NETWORK` | 网络或代理问题；DSH 需要能访问 `business.aliyuncs.com` |
| 提示「这个 AccessKey ID 已经添加过了」 | 同一把 AK 不能重复添加，先移除旧条目 |
| 面板/卡片没出现 | 设置 → 插件 里确认已启用；刷新页面；仍不行就关闭再启用一次 |
| 改了代码不生效 | 宿主模块有缓存：设置 → 插件 **关闭再启用**；客户端改动还需**刷新页面** |
| 余额为 0 但控制台有券 | 插件只统计 `Status=Available` 且未过期的券；请对照控制台的「可用」页 |

## 已知限制

- 只统计**代金券余额**，不包含账户现金余额、储值卡等（那需要另一个接口 `QueryAccountBalance`）。
- `QueryCashCoupons` 没有分页参数，一次返回该账号全部代金券；券特别多时面板只展示前 60 张。
- 部分账号调用会返回 `NotApplicable`，这是阿里云侧的账号类型限制，插件无法绕过。
- 最多 20 个账号；同一时刻对同一账号的最小刷新间隔是 30 秒（防止触发限流）。
- 历史采样保留 30 天，面板曲线最多展示最近 120 个点。

## 目录结构

```
aliyun-coupon-plugin/
├── package.json          # 包清单：dsh.bundle.patch + dsh.client（声明 Web 客户端）
├── cordis.patch.yml      # 向 profile 插入一行 aliyun-coupon 插件
├── index.js              # 宿主侧：签名、缓存、采样、HTTP 路由、Agent 工具
├── client.js             # 浏览器侧：侧栏卡片、图标入口、详情面板、账号表单
├── locale/
│   ├── zh.json           # 插件列表里的中文标题/描述
│   └── en.json
├── icon.svg              # 插件图标
└── README.md
```

## 开发与调试

宿主代码改动后，Node 模块有缓存，**必须让插件重新加载**：

```
设置 → 插件 → @local/aliyun-coupon → 关闭 → 再启用
```

客户端（`client.js`）改动后，除重载插件外还要**刷新浏览器页面**。

快速自测接口（DSH 默认只监听本机）：

```bash
curl http://127.0.0.1:<DSH端口>/aliyun-coupon/state
```

验证签名是否正确，可以故意用假 AK 调用一次 `/accounts`，若返回 `InvalidAccessKeyId.NotFound` 就说明请求格式、签名流程、网络通路都正常（而不是 `SignatureDoesNotMatch`）。

## 版本历史

| 版本 | 变更 |
|---|---|
| 1.1.0 | 多账号支持：账号增删改、并发刷新、按账号采样与曲线；旧版单账号配置自动迁移 |
| 1.0.0 | 首个版本：单账号余额卡片 + 详情面板 + Agent 工具 |

## 许可

仓库暂未声明许可证。如果你要对外分发，建议补充 `LICENSE`（例如 MIT）。