import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiBase, type Overview } from '@/lib/api'
import { CopyButton } from './shared'

export function Guide({ config }: { config: Overview['config'] }) {
  const curl = `curl "${apiBase}/models"${config.api_key_required ? ' -H "Authorization: Bearer $QUICKPROXY_API_KEY"' : ''}`
  const python = `from openai import OpenAI\n${config.api_key_required ? 'import os\n' : ''}\nclient = OpenAI(\n    base_url=${JSON.stringify(apiBase)},\n    api_key=${config.api_key_required ? 'os.environ["QUICKPROXY_API_KEY"]' : '"local"'},\n)\n\nresponse = client.chat.completions.create(\n    model=${JSON.stringify(config.default_model)},\n    messages=[{"role": "user", "content": "你好"}],\n)\nprint(response.choices[0].message.content)`

  return (
    <Tabs defaultValue='connection' className='min-w-0 gap-5'>
      <TabsList aria-label='接入指南'>
        <TabsTrigger value='connection'>连接信息</TabsTrigger>
        <TabsTrigger value='examples'>调用示例</TabsTrigger>
        <TabsTrigger value='config'>运行配置</TabsTrigger>
      </TabsList>

      <TabsContent value='connection' className='max-w-xl space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='base-url'>Base URL</Label>
          <div className='flex items-center gap-2'>
            <Input id='base-url' readOnly value={apiBase} />
            <CopyButton value={apiBase} label='复制 Base URL' />
          </div>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='default-model'>默认模型</Label>
          <Input id='default-model' readOnly value={config.default_model} />
        </div>
        <p className='text-sm text-muted-foreground'>
          {config.api_key_required
            ? '在客户端的 API Key 字段填写代理配置中的密钥。'
            : <>此实例已关闭 API 密钥鉴权。客户端要求填写 API Key 时，可使用 <code>local</code>。</>}
        </p>
      </TabsContent>

      <TabsContent value='examples' className='min-w-0 max-w-3xl space-y-5'>
        {config.api_key_required && (
          <p className='text-sm text-muted-foreground'>
            请先将代理的 API 密钥存入环境变量 <code>QUICKPROXY_API_KEY</code>。
          </p>
        )}
        {[['cURL · 列出模型', curl], ['Python · 发起对话', python]].map(([label, code]) => (
          <div className='space-y-1' key={label}>
            <div className='flex items-center justify-between gap-2'>
              <h3 className='text-sm font-medium'>{label}</h3>
              <CopyButton value={code} label={`复制 ${label} 示例`} />
            </div>
            <pre className='overflow-x-auto rounded-md bg-muted p-4 text-sm'><code>{code}</code></pre>
          </div>
        ))}
      </TabsContent>

      <TabsContent value='config' className='max-w-xl'>
        <dl className='divide-y'>
          {[
            ['默认模型', config.default_model],
            ['请求超时', config.request_timeout],
            ['最大尝试次数', config.max_attempts],
            ['提前刷新时间', config.refresh_before],
            ['API 密钥鉴权', config.api_key_required ? '已开启' : '未开启'],
          ].map(([label, value]) => (
            <div key={label} className='flex items-center justify-between gap-4 py-2 text-sm'>
              <dt className='text-muted-foreground'>{label}</dt>
              <dd className='font-medium'>{value}</dd>
            </div>
          ))}
        </dl>
      </TabsContent>
    </Tabs>
  )
}
