const fields = document.getElementById('fields')
const hours = document.getElementById('hours')
const transport = document.getElementById('transport')
const save = document.getElementById('save')
const status = document.getElementById('status')

async function loadSettings() {
  try {
    await magpie.ready
    const options = await magpie.options.get()
    hours.value = options?.monthlyHours ?? 10
    transport.value = options?.transport ?? 'aidp'
    fields.disabled = false
  } catch {
    status.textContent = '读取设置失败，请重新打开面板。'
  }
}

fields.addEventListener('input', () => {
  hours.setCustomValidity('')
  status.textContent = ''
})

save.addEventListener('click', async () => {
  const monthlyHours = hours.valueAsNumber
  if (!Number.isFinite(monthlyHours) || monthlyHours <= 0) {
    hours.setCustomValidity('请输入大于 0 的小时数。')
    hours.reportValidity()
    return
  }
  fields.disabled = true
  status.textContent = '正在保存…'
  try {
    const options = await magpie.options.get()
    await magpie.options.set({ ...options, monthlyHours, transport: transport.value })
    status.textContent = '已保存'
  } catch {
    status.textContent = '保存失败，请重试。'
  } finally {
    fields.disabled = false
  }
})

loadSettings()
