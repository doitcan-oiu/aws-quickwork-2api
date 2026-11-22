const byId = id => document.getElementById(id)
const heading = byId('heading')
const instruction = byId('instruction')
const approval = byId('approval')
const approvalURL = byId('approval-url')
const copyStatus = byId('copy-status')
const form = byId('form')
const callback = byId('callback')
const error = byId('error')
const submit = byId('submit')
const restart = byId('restart')
const firstMark = byId('first-mark')
const secondMark = byId('second-mark')

let step = 1
let busy = false
let expectedState = ''
let expectedPort = ''

function isLoopback(url) {
  return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
    && url.port && !url.username && !url.password && !url.hash
}

function pastedCallback() {
  let url
  try { url = new URL(callback.value.trim()) } catch {}
  if (!url || !isLoopback(url)) {
    throw new Error('请从浏览器地址栏复制完整回调链接，地址以 http://localhost: 或 http://127.0.0.1: 开头。')
  }
  if (step === 1) {
    if (url.pathname !== '/callback' || !url.searchParams.get('nonce')) {
      throw new Error('第一步需要登录后带有 /callback 和 nonce 的地址。请复制第一个回调链接。')
    }
  } else {
    if (!['/', '/index.html'].includes(url.pathname) || !url.searchParams.get('state')) {
      throw new Error('第二步需要确认授权后的回调链接。请在刚才的浏览器中打开上方授权链接，完成后复制地址。')
    }
    if (url.port !== expectedPort || url.searchParams.get('state') !== expectedState) {
      throw new Error('这个回调链接来自另一次登录。请打开上方授权链接，复制本次授权后的地址。')
    }
    if (!url.searchParams.get('code') && !url.searchParams.has('error')) {
      throw new Error('回调链接缺少授权结果。请复制授权后地址栏中的完整地址。')
    }
  }
  return url
}

function showApproval(value, port) {
  let url, redirect
  try {
    url = new URL(value)
    redirect = new URL(url.searchParams.get('redirect_uri'))
  } catch {}
  const state = url?.searchParams.get('state')
  if (url?.protocol !== 'https:' || url.username || url.password || !state
    || !redirect || !isLoopback(redirect) || redirect.port !== port) {
    throw new Error('未收到本次登录的授权链接。请重试第一步。')
  }
  step = 2
  expectedState = state
  expectedPort = redirect.port
  firstMark.removeAttribute('aria-current')
  firstMark.textContent = '✓ 已登录账号'
  secondMark.setAttribute('aria-current', 'step')
  heading.textContent = '第 2/2 步 · 确认授权'
  instruction.textContent = '复制下方授权链接，在刚才登录的浏览器窗口打开。确认授权后，复制地址栏里的第二个回调链接并粘贴到这里。'
  byId('start-help').hidden = true
  approvalURL.value = url.href
  approval.hidden = false
  callback.value = ''
  byId('callback-label').textContent = '第二个回调链接'
  callback.placeholder = '粘贴确认授权后的完整地址'
  restart.hidden = false
  restart.textContent = '重新开始登录'
  heading.focus()
}

function clearLinks() {
  expectedState = ''
  expectedPort = ''
  callback.value = ''
  approvalURL.value = ''
  copyStatus.textContent = ''
}

function showDone() {
  step = 3
  clearLinks()
  firstMark.textContent = '✓ 已登录账号'
  secondMark.removeAttribute('aria-current')
  secondMark.textContent = '✓ 已确认授权'
  heading.textContent = '已完成 Amazon Quick 登录'
  instruction.textContent = '两个回调均已提交。返回 Magpie 的「供应商 → Amazon Quick」查看账号。'
  approval.hidden = true
  form.hidden = true
  restart.textContent = '添加另一个账号'
  restart.hidden = false
  heading.focus()
}

byId('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(approvalURL.value)
    copyStatus.textContent = '已复制，请在刚才登录的浏览器窗口打开。'
  } catch {
    approvalURL.focus()
    approvalURL.select()
    approvalURL.setSelectionRange(0, approvalURL.value.length)
    let copied = false
    try { copied = document.execCommand('copy') } catch {}
    copyStatus.textContent = copied ? '已复制，请在刚才登录的浏览器窗口打开。' : '链接已选中，请使用系统复制菜单或复制快捷键。'
  }
})

submit.addEventListener('click', async () => {
  if (busy || step > 2) return
  error.textContent = ''
  let url
  try {
    url = pastedCallback()
  } catch (err) {
    error.textContent = err.message
    callback.setAttribute('aria-invalid', 'true')
    callback.focus()
    return
  }
  busy = true
  callback.readOnly = true
  submit.disabled = true
  restart.disabled = true
  submit.textContent = '正在提交…'
  form.setAttribute('aria-busy', 'true')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 120000)
  try {
    const response = await fetch('./callback', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step, url: callback.value.trim() }),
    })
    const result = await response.json().catch(() => null)
    if (typeof result?.error === 'string' && result.error) throw new Error(result.error)
    if (!response.ok || !result) throw new Error('登录服务未返回结果。请检查插件连接，再提交当前回调。')
    if (step === 1 && result.step === 2) showApproval(result.url, url.port)
    else if (step === 2 && result.done === true) showDone()
    else throw new Error('登录服务未确认当前步骤。请重新提交当前回调。')
  } catch (err) {
    if (controller.signal.aborted) error.textContent = '提交超时。请在「供应商 → Amazon Quick」查看登录状态，仍在等待时可重试当前回调。'
    else if (err instanceof TypeError) error.textContent = '连接登录服务失败。请检查网络，再提交当前回调。'
    else error.textContent = err.message
  } finally {
    clearTimeout(timeout)
    busy = false
    callback.readOnly = false
    restart.disabled = false
    submit.disabled = !callback.value.trim()
    submit.textContent = step === 1 ? '提交并继续' : '提交并完成登录'
    form.removeAttribute('aria-busy')
  }
})

callback.addEventListener('input', () => {
  error.textContent = ''
  callback.removeAttribute('aria-invalid')
  submit.disabled = busy || !callback.value.trim()
})
restart.addEventListener('click', () => {
  clearLinks()
  step = 1
  firstMark.textContent = '1 · 登录账号'
  firstMark.setAttribute('aria-current', 'step')
  secondMark.textContent = '2 · 确认授权'
  secondMark.removeAttribute('aria-current')
  heading.textContent = '第 1/2 步 · 登录 AWS 账号'
  instruction.textContent = '先在「供应商 → Amazon Quick」发起新的登录。复制登录链接，在你选择的浏览器或无痕窗口打开，登录后将第一个回调链接粘贴到这里。'
  byId('start-help').hidden = true
  byId('callback-label').textContent = '第一个回调链接'
  callback.placeholder = '粘贴登录后的完整地址'
  callback.removeAttribute('aria-invalid')
  approval.hidden = true
  error.textContent = ''
  form.hidden = false
  submit.textContent = '提交并继续'
  submit.disabled = true
  restart.hidden = true
  heading.focus()
})
window.addEventListener('pagehide', clearLinks)
window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload()
})
