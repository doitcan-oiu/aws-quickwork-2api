# Amazon Quick for Magpie

在 Magpie 里登录 Amazon Quick 后，接入 Magpie 的客户端即可使用 `amazon-quick/smart`、`amazon-quick/fast`、`amazon-quick/balanced` 和 `amazon-quick/auto`。插件直接连接 Quick 的 WebSocket，支持文本对话、流式响应和客户端工具调用。

## 安装和登录

在本仓库根目录运行下面两条命令。仓库已包含可以直接加载的插件，Magpie 会准备运行时。

```sh
magpie plugin add "$PWD"
magpie plugin login amazon-quick
```

选择个人账号或企业账号，在浏览器完成 Amazon 授权。也可以在 Magpie 的「插件 → 添加插件」粘贴仓库的绝对路径，再点击登录。授权会回到运行 Magpie 的机器。远程部署时，可把登录提示里的回调端口通过 SSH 转发到浏览器所在的机器。

```sh
magpie plugin                         # 查看插件状态
magpie provider test amazon-quick     # 向已登录账号发起一次测试请求
magpie codex amazon-quick/fast         # 让 Codex 使用 Quick Fast
magpie quota                          # 查看账号用量
```

账号凭据由 Magpie 保存并续期。旧版 QuickProxy 的 SQLite 账号库保留在原处，首次使用插件时需在 Magpie 重新登录。

## 本月剩余

Magpie 的用量卡显示每个账号的「本月剩余」。默认预算为 10 小时，按 UTC 自然月更新，只统计通过此插件的回合。同一轮的用量事件均带 `duration_ms` 时使用上游时长，其余按发送消息至最后输出或完成事件的时间计量。Amazon 的计费还涉及模式和并行任务，官方余额可在 Quick 的 Mission Control 查看。

插件在 Magpie 配置目录的 `amazon-quick/usage.sqlite` 中按账号保存月度时长。插件参数 `monthlyHours` 可修改每账号的小时预算。传输默认为 `aidp`，使用 Quick Gateway 的部署可将插件参数 `transport` 设为 `gateway`。

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
