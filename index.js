import { homedir } from 'node:os'
import { join } from 'node:path'
import { createAuthMethods, getSession, refreshAuth, sessionFromAuth } from './src/auth.js'
import { createChatFetch } from './src/chat.js'
import { startLoginWizard } from './src/login-wizard.js'
import { readOptions } from './src/options.js'
import { accountUsage, recordTurn } from './src/usage.js'

const provider = 'amazon-quick'
// All calls to this SDK base are handled by the plugin's custom fetch.
const baseURL = 'https://amazon-quick.invalid/v1'
const models = Object.fromEntries(['smart', 'fast', 'balanced', 'auto'].map(mode => [
  mode, { name: 'Amazon Quick ' + mode, tool_call: true, modalities: { input: ['text'], output: ['text'] } },
]))

export async function AmazonQuickPlugin({ client, directory, magpie }, options = {}) {
  const dataDir = magpie && directory ? directory : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'magpie')
  const clientOptions = readOptions(options)
  let wizardAvailable = false
  if (magpie) {
    try {
      await startLoginWizard(clientOptions.loginWizardPort)
      wizardAvailable = true
    } catch {
      await client.app?.log?.({ body: { service: provider, level: 'warn', message: '登录向导端口无法监听。可使用供应商卡片完成登录，或在插件高级设置中更改端口。' } })
    }
  }
  return {
    async config(config) {
      config.provider ??= {}
      config.provider[provider] = {
        name: 'Amazon Quick', npm: '@ai-sdk/openai-compatible', api: baseURL,
        ...config.provider[provider], models: { ...models, ...config.provider[provider]?.models },
      }
    },
    auth: {
      provider,
      methods: createAuthMethods(clientOptions, wizardAvailable),
      refresh: refreshAuth,
      async usage(getAuth) {
        return accountUsage(dataDir, sessionFromAuth(await getAuth()), clientOptions.monthlyHours)
      },
      async loader(getAuth) {
        // Magpie owns refresh and serializes it across processes. OpenCode
        // doesn't call the Magpie refresh hook, so use the loader there.
        async function session() {
          const account = magpie
            ? sessionFromAuth(await getAuth())
            : await getSession(getAuth, body => client.auth.set({ path: { id: provider }, body }))
          if (clientOptions.transport === 'gateway') account.provider = account.provider === 'social' ? 'social_gateway' : 'gateway'
          return account
        }
        return {
          baseURL, apiKey: provider,
          fetch: createChatFetch({
            baseURL, models, session, clientOptions,
            record: async (accountId, timing) => {
              try { await recordTurn(dataDir, accountId, timing) }
              catch {
                await client.app?.log?.({ body: { service: provider, level: 'warn', message: 'Could not save monthly usage' } })
              }
            },
          }),
        }
      },
    },
  }
}
