import { defaultOptions, readOptions } from './options.js'

const fields = document.getElementById('fields')
const controls = fields.querySelectorAll('input[name], select[name]')
const status = document.getElementById('status')

async function loadSettings() {
  try {
    await magpie.ready
    const options = await magpie.options.get()
    for (const control of controls) {
      const value = options?.[control.name] ?? defaultOptions[control.name]
      if (control.type === 'checkbox') control.checked = value === true
      else control.value = value
    }
    fields.disabled = false
  } catch {
    status.textContent = '读取设置失败，请重新打开面板。'
  }
}

fields.addEventListener('input', ({ target }) => {
  target.setCustomValidity('')
  status.textContent = ''
})

document.getElementById('save').addEventListener('click', async () => {
  const input = {}
  for (const control of controls) {
    if (control.type === 'checkbox') input[control.name] = control.checked
    else if (control.type === 'number') input[control.name] = control.valueAsNumber
    else input[control.name] = control.value
  }
  let values
  try {
    values = readOptions(input)
  } catch (err) {
    const field = fields.elements.namedItem(err.field)
    const advanced = field.closest('details')
    if (advanced) advanced.open = true
    field.setCustomValidity(err.message)
    field.reportValidity()
    status.textContent = err.message
    return
  }
  fields.disabled = true
  status.textContent = '正在保存…'
  try {
    const options = await magpie.options.get()
    await magpie.options.set({ ...options, ...values })
    status.textContent = '已保存'
  } catch {
    status.textContent = '保存失败，请重试。'
  } finally {
    fields.disabled = false
  }
})

loadSettings()
