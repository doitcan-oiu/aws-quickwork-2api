# Amazon Quick for Magpie

在 Magpie 里登录 Amazon Quick 后，接入 Magpie 的客户端即可使用 `amazon-quick/smart`、`amazon-quick/fast`、`amazon-quick/balanced` 和 `amazon-quick/auto`。插件直接连接 Quick 的 WebSocket，支持文本对话、流式响应和客户端工具调用。

## 安装和登录

在 Magpie 的「插件 → 添加插件」粘贴本仓库的 GitHub 链接，安装后可从「插件 → 已安装」检查更新。如果已经克隆本仓库，也可以在仓库根目录运行：

```sh
magpie plugin add "$PWD"
magpie plugin login amazon-quick
```

在「供应商」选择 Amazon Quick，选个人账号或企业账号，复制登录链接到你想用的浏览器或无痕窗口。本机运行 Magpie 时，浏览器可以自动完成回调。

通过 Docker 或远程 Web 登录时，在同一个浏览器会话完成以下两步：

1. 登录 AWS 后，复制地址栏里以 `http://127.0.0.1` 或 `http://localhost` 开头的完整地址。回到 Magpie，把它粘贴进「回调 URL」，点「完成登录」。即使回调页面显示连接失败，也可以复制地址。
2. 等 Magpie 卡片上的链接更新，复制新链接到刚才的浏览器完成授权。再次复制地址栏里的完整回调，粘贴进 Magpie 并提交。登录成功后，账号就会出现在 Amazon Quick 下。

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

插件在 Magpie 配置目录的 `amazon-quick/usage.sqlite` 中按账号保存月度时长。在「设置 → 插件 → Amazon Quick」可修改每个账号使用的月度额度（小时）和连接方式，点「保存」后生效。默认连接方式为 AIDP，也可选择 Quick Gateway。

企业账号默认使用 `us-east-1` 发起登录。其他区域可在启动 Magpie 前设置 `AMAZON_QUICK_REGION`。企业自有身份服务可将准确主机名写入 `AMAZON_QUICK_IDP_HOSTS`，多个以逗号分隔。

## 开发

源码入口为 `index.js`，Magpie 从 `dist/amazon-quick.mjs` 加载发行文件。修改源码后，用 Bun 重新构建并提交发行文件。测试使用 Node.js 24 和本机模拟服务。

```sh
bun install --frozen-lockfile
bun run build
bun run test
```

工具由调用方执行。Quick 的文本工具协议需要在回合结束时解析，因此带客户端工具的请求会缓冲到该轮结束。插件只声明文本输入和输出。

本项目使用 GPL-3.0 许可证。插件接口和宿主运行方式见 [Magpie 中文插件开发文档](https://usemagpie.ai/docs/zh/plugins)。
