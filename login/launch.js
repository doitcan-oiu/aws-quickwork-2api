const retry = document.getElementById('retry')
const status = document.getElementById('status')

async function openWizard() {
  retry.hidden = true
  status.textContent = '正在打开 Amazon Quick 登录向导…'
  // A failed navigation can leave the current document in place in WebKit.
  const timeout = setTimeout(() => {
    retry.hidden = false
    status.textContent = '登录向导连接超时。请确认插件已启用，然后重试。'
  }, 8000)
  try {
    await magpie.ready
    let url = magpie.service
    if (!url) {
      const options = await magpie.options.get()
      const port = Number(options?.loginWizardPort ?? 43871)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error()
      url = 'http://127.0.0.1:' + port + '/'
    }
    location.replace(url)
  } catch {
    clearTimeout(timeout)
    status.textContent = '无法打开登录向导。请检查插件设置中的向导端口，再试一次。'
    retry.hidden = false
  }
}

retry.addEventListener('click', openWizard)
openWizard()
