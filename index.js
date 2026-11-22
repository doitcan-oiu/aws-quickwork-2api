import { homedir } from 'node:os'
import { join } from 'node:path'
import { authMethods, getSession, refreshAuth, sessionFromAuth } from './src/auth.js'
import { createChatFetch } from './src/chat.js'
import { accountUsage, recordTurn } from './src/usage.js'

const provider = 'amazon-quick'
// All calls to this SDK base are handled by the plugin's custom fetch.
const baseURL = 'https://amazon-quick.invalid/v1'
const models = Object.fromEntries(['smart', 'fast', 'balanced', 'auto'].map(mode => [
  mode, { name: 'Amazon Quick ' + mode, tool_call: true, modalities: { input: ['text'], output: ['text'] } },
]))

export async function AmazonQuickPlugin({ client, directory, magpie }, options = {}) {
  const dataDir = magpie && directory ? directory : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'magpie')
  const budget = options.monthlyHours ?? 10
  if (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0) throw new Error('monthlyHours must be a positive number')
  const transport = options.transport ?? 'aidp'
  if (!['aidp', 'gateway'].includes(transport)) throw new Error('transport must be aidp or gateway')
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
      methods: authMethods,
      refresh: refreshAuth,
      async usage(getAuth) {
        return accountUsage(dataDir, sessionFromAuth(await getAuth()), budget)
      },
      async loader(getAuth) {
        // Magpie owns refresh and serializes it across processes. OpenCode
        // doesn't call the Magpie refresh hook, so use the loader there.
        async function session() {
          const account = magpie
            ? sessionFromAuth(await getAuth())
            : await getSession(getAuth, body => client.auth.set({ path: { id: provider }, body }))
          if (transport === 'gateway') account.provider = account.provider === 'social' ? 'social_gateway' : 'gateway'
          return account
        }
        return {
          baseURL, apiKey: provider,
          fetch: createChatFetch({
            baseURL, models, session,
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
