# Amazon Quick for Magpie

在 Magpie 里登录 Amazon Quick 后，接入 Magpie 的客户端即可使用 `amazon-quick/smart`、`amazon-quick/fast`、`amazon-quick/balanced` 和 `amazon-quick/auto`。插件直接连接 Quick 的 WebSocket，支持文本对话、流式响应和客户端工具调用。

## 安装和登录

在 Magpie 的「插件 → 添加插件」粘贴本仓库的 GitHub 链接，安装后可从「插件 → 已安装」检查更新。如果已经克隆本仓库，也可以在仓库根目录运行：

```sh
magpie plugin add "$PWD"
magpie plugin login amazon-quick
```

在「供应商」选择 Amazon Quick，选个人账号或企业账号，复制登录链接到你想用的浏览器或无痕窗口。本机运行 Magpie 时，浏览器可以自动完成回调。

通过 Docker 或远程 Web 登录时，复制供应商卡片上的登录链接，在你选的浏览器中打开。回到 Magpie，点左侧的 **Quick 登录**，两条回调都粘贴在这里。即使浏览器提示无法连接，也可以从地址栏复制完整回调。

1. **第 1/2 步 · 登录 AWS**。登录后粘贴浏览器地址栏里的第一条回调（路径为 `/callback`）。验证通过后，向导会显示第 2 步和新的授权链接。
2. **第 2/2 步 · 完成授权**。复制授权链接，在刚才的浏览器会话中打开并同意授权，再粘贴第二条完整回调。向导显示完成后，可在「供应商 → Amazon Quick」查看账号。

原供应商卡片的「回调 URL」也可以连续提交两次。使用该入口时，第一条回调通过后，卡片上的链接会换成授权链接。

需要多个账号时，选择「添加另一个 Amazon Quick 账号」并重复登录。给每个账号使用独立的浏览器配置文件，或关闭上一个账号的所有无痕窗口后再开新窗口，避免 AWS 自动选回刚才的账号。

```sh
magpie plugin                         # 查看插件状态
magpie provider test amazon-quick     # 向已登录账号发起一次测试请求
magpie codex amazon-quick/fast         # 让 Codex 使用 Quick Fast
magpie quota                          # 查看账号用量
```

账号凭据由 Magpie 保存并续期。旧版 QuickProxy 的 SQLite 账号库保留在原处，首次使用插件时需在 Magpie 重新登录。

## 本月剩余

Magpie 的用量卡显示每个账号的「本月剩余」。默认预算为 10 小时，按 UTC 自然月更新，只统计通过此插件的回合。同一轮的用量事件均带 `duration_ms` 时使用上游时长，其余按发送消息至最后输出或完成事件的时间计量。Amazon 的计费还涉及模式和并行任务，官方余额可在 Quick 的 Mission Control 查看。

插件在 Magpie 配置目录的 `amazon-quick/usage.sqlite` 中按账号保存月度时长。

## 插件设置

打开「设置 → 插件 → Amazon Quick」，可以直接修改 **Quick App 版本号**、每账号月度额度和连接方式。App 版本默认是 `1.2.4660`。保存后，之后的 AWS 登录链接和对话都会使用新值，已有账号无需重新登录。默认连接方式为 AIDP，也可选择 Quick Gateway。

展开「高级设置」还可以调整：

| 设置 | 默认行为 |
| --- | --- |
| AWS 登录区域 | 留空时使用服务器的 `AMAZON_QUICK_REGION`，未配置时使用 `us-east-1`。个人账号优先采用 AWS 登录过程中返回的区域。 |
| 对话时区、语言 | `UTC`、`en-US`。例如可填 `Asia/Taipei` 和 `zh-TW`。时区仅用于发给 Quick 的消息，月度统计仍按 UTC 归集。 |
| 思考强度 | 跟随上游，也可选择低、中或高。 |
| 请求超时 | 默认每次聊天最多 300 秒。 |
| 客户端标识（Surface） | `QUICK_WORK_DESKTOP_WINDOWS`。 |
| Outpost ID、Working Session ID | 默认留空，需要时填写部署所用的标识。 |
| 保留上游会话 | 默认在回合结束后清理，勾选后保留。 |

以上设置对这个插件的所有账号生效。企业自有身份服务的受信任主机名由服务器环境变量 `AMAZON_QUICK_IDP_HOSTS` 指定，多个主机名以逗号分隔。

## 开发

源码入口为 `index.js`，设置面板脚本的源码为 `src/settings-panel.js`。修改后用 Bun 重新构建，并提交生成的 `dist/amazon-quick.mjs` 和 `settings/settings.js`。测试使用 Node.js 24 和本机模拟服务。

```sh
bun install --frozen-lockfile
bun run build
bun run test
```

工具由调用方执行。Quick 的文本工具协议需要在回合结束时解析，因此带客户端工具的请求会缓冲到该轮结束。插件只声明文本输入和输出。

本项目使用 GPL-3.0 许可证。插件接口和宿主运行方式见 [Magpie 中文插件开发文档](https://usemagpie.ai/docs/zh/plugins)。
