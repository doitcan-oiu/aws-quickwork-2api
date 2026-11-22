(() => {
  // package.json
  var package_default = {
    name: "magpie-amazon-quick",
    version: "1.3.2",
    description: "Amazon Quick subscription provider for Magpie",
    magpie: {
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0NCA0NCI+PHN0eWxlPnBhdGh7ZmlsbDojMWMxYzFlfUBtZWRpYSAocHJlZmVycy1jb2xvci1zY2hlbWU6ZGFyayl7cGF0aHtmaWxsOiNmMmYyZjJ9fTwvc3R5bGU+PHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNMS41IDUuNUMxLjMgNS43IDEuMiA2LjUgMS4yIDYuOUMxLjIgNi45IDEuMiA3IDEuMiA3LjFDMS4xIDcuNCAxLjMgOCAxLjQgOC4zQzEuNCA4LjQgMS41IDguNSAxLjUgOC43QzEuNSA4LjkgMS43IDkgMS44IDkuM0MyLjIgOS45IDIuMiAxMCAyLjMgMTAuMUMyLjQgMTAuMiAyLjUgMTAuMyAyLjYgMTAuNUMyLjggMTAuOCAzIDExLjEgMy4yIDExLjNDMy4zIDExLjMgMy40IDExLjYgMy42IDExLjhDMy44IDEyIDQuMSAxMi40IDQuMiAxMi41QzQuNyAxMyA1LjIgMTMuNyA1LjQgMTMuOUM2IDE0LjUgNi41IDE1LjEgNi43IDE1LjNDNi43IDE1LjQgNi45IDE1LjUgNi45IDE1LjdDNy4zIDE1LjkgNy43IDE2LjUgNy45IDE2LjhDNy45IDE2LjggOCAxNi45IDggMTYuOUM4LjEgMTYuOSA4LjIgMTcuMiA4LjIgMTcuM0M4LjIgMTcuMyA4LjEgMTcuMiA4LjEgMTcuMUM3LjkgMTYuOSA3LjkgMTYuOSA3LjYgMTYuNkM3LjUgMTYuNSA3LjQgMTYuNSA3LjQgMTYuM0M3LjIgMTYuMiA2LjcgMTUuNyA2LjMgMTUuMkM2LjEgMTUuMSA2IDE0LjkgNiAxNC45QzUuOSAxNC44IDUuNyAxNC43IDUuNyAxNC42QzUuNiAxNC41IDUuNCAxNC4zIDUuMyAxNC4yQzUuMSAxNC4xIDQuOSAxMy44IDQuNyAxMy41QzQuNSAxMy4zIDQuMiAxMy4xIDQuMSAxMi45QzQuMSAxMi45IDMuOCAxMi43IDMuOCAxMi41QzMuNSAxMi4zIDMgMTEuOCAyLjggMTEuNEMxLjggMTAuNSAwLjkgOS42IDAuNyA5LjZDMC42IDkuNyAwLjYgOS44IDAuNSAxMEMwLjUgMTAuMSAwLjYgMTAuMiAwLjUgMTAuM0MwLjUgMTAuNCAwLjYgMTAuNSAwLjYgMTAuNkMwLjUgMTAuNyAwLjUgMTAuOSAwLjYgMTFDMC41IDExLjEgMC42IDExLjQgMC42IDExLjVDMC45IDEyLjkgMS4zIDEzLjggMi44IDE0LjlDMi45IDE1LjEgMy4zIDE1LjMgMy40IDE1LjRDMy40IDE1LjUgMy42IDE1LjYgMy43IDE1LjdDNC4yIDE2IDYuNCAxNy44IDcgMTguNEM3LjQgMTguOCA3LjQgMTguOCA3LjUgMTguOUM3LjYgMTkgNy43IDE5IDcuNyAxOS4xQzcuNyAxOS4yIDcuOCAxOS4yIDcuOSAxOS4yQzcuOSAxOS4zIDguMSAxOS40IDguMSAxOS41QzguMiAxOS42IDguMiAxOS43IDguMyAxOS43QzguMyAxOS43IDguMyAxOS43IDguMiAxOS43QzguMiAxOS42IDguMSAxOS42IDggMTkuNkM3LjkgMTkuNSA3LjkgMTkuNCA3LjggMTkuNEM3LjcgMTkuMyA3LjYgMTkuMiA3LjYgMTkuMkM3LjYgMTkuMSA3LjUgMTkgNy4zIDE4LjlDNy4yIDE4LjkgNi45IDE4LjYgNi43IDE4LjRDNi4xIDE3LjggNC41IDE2LjYgMy41IDE2QzMuNCAxNS44IDMgMTUuNiAyLjkgMTUuNUMyLjYgMTUuMyAxLjUgMTQuNiAwLjkgMTQuM0MwLjcgMTQuMSAwLjYgMTQuMSAwLjYgMTQuMkMwLjUgMTQuNSAwLjggMTUuOSAwLjkgMTYuMUMwLjkgMTYuMiAxIDE2LjIgMC45IDE2LjNDMS4yIDE2LjggMS45IDE3LjYgMi43IDE4LjNDMi44IDE4LjUgNCAxOS4yIDQuNyAxOS41QzYuMiAyMC41IDYuNiAyMC43IDcuNCAyMS41QzguMiAyMi4yIDguNyAyMi43IDkuMyAyMy42QzkuNSAyNC4xIDkuOSAyNC40IDEwLjMgMjUuM0MxMC40IDI1LjUgMTAuNSAyNS44IDEwLjUgMjUuOEMxMC43IDI1LjggMTAuOCAyNS43IDExIDI1LjRDMTEuNiAyNSAxMS45IDI0LjYgMTIuMyAyNC4zQzEyLjggMjQgMTMgMjMuOCAxMyAyMy43QzEzLjEgMjMuNyAxMy4xIDIzLjggMTMgMjRDMTIgMjQuOCAxMSAyNiAxMC4yIDI2LjlDMTAuMSAyNy4xIDkuOSAyNy41IDkuNyAyNy43QzkuNSAyNy44IDkuNCAyOCA5LjQgMjhDOS40IDI4IDkuMyAyOC4zIDkuMSAyOC41QzguNiAyOS4yIDcuNyAzMC44IDcuNyAzMC45QzcuNyAzMSA3LjggMzEgOC4zIDMwLjhDOSAzMC40IDkuNSAzMC4yIDEwLjQgMzBDMTEuNyAyOS42IDEyLjUgMjkuNiAxMS42IDMwQzEwLjUgMzAuMiA5LjcgMzAuNiA5LjIgMzEuMkM4LjggMzEuNyA4LjggMzEuNyA5LjMgMzEuN0MxMC4xIDMxLjggMTAuOSAzMS45IDExLjYgMzIuMkMxMi44IDMyLjcgMTMuNSAzMy4xIDE1LjUgMzQuOEMxNi40IDM1LjUgMTcuMyAzNi4yIDE3LjggMzYuNEMxNy45IDM2LjUgMTguMSAzNi43IDE4LjIgMzYuOEMxOS4xIDM3LjMgMjEuMiAzOC4xIDIyLjMgMzguM0MyMi40IDM4LjMgMjIuNyAzOC4zIDIyLjggMzguM0MyMi44IDM4LjUgMjMgMzguNSAyMyAzOC41QzIzLjEgMzguNSAyMy4yIDM4LjUgMjMuMyAzOC41QzIzLjYgMzguNiAyNS45IDM4LjYgMjYuMSAzOC41QzI2LjIgMzguNSAyNi4zIDM4LjUgMjYuNCAzOC41QzI2LjUgMzguNSAyNi42IDM4LjUgMjYuNyAzOC4zQzI2LjcgMzguMyAyNyAzOC4zIDI3LjEgMzguM0MyOC4zIDM4LjEgMzAuMiAzNy4zIDMxLjQgMzYuN0MzMS41IDM2LjcgMzEuNyAzNi40IDMxLjggMzYuNEMzMi4yIDM2LjIgMzMuMiAzNS40IDMzLjQgMzUuMkMzNC4yIDM0LjUgMzUuNSAzMyAzNS44IDMyLjZDMzUuOCAzMi41IDM2IDMyLjIgMzYuMSAzMkMzNi40IDMxLjggMzYuNiAzMS40IDM2LjYgMzEuMkMzNi43IDMxLjEgMzYuOCAzMC45IDM2LjkgMzAuOEMzNy4yIDMwLjQgMzcuNSAyOS42IDM3LjcgMjkuMkMzNy43IDI5LjEgMzcuOCAyOC43IDM3LjkgMjguN0MzOC4xIDI4LjUgMzguNCAyNy4xIDM4LjUgMjYuOEMzOSAyNS4yIDM5LjEgMjMuNyAzOSAyMi40QzM5IDIyLjIgMzguOSAyMS45IDM4LjkgMjEuOEMzOC45IDIxLjcgMzguOSAyMS42IDM4LjkgMjEuNEMzOC42IDIwLjUgMzguNSAxOS45IDM4LjIgMTlDMzcuOSAxOC41IDM3LjUgMTcuNSAzNy4zIDE3LjJDMzcgMTYuOCAzNi44IDE1LjggMzYuOCAxNS4yQzM2LjggMTMuOCAzNy43IDEyLjcgMzkuNiAxMi4yQzQwLjEgMTIuMSA0MS4zIDExLjggNDIuMSAxMS43QzQzLjUgMTEuNSA0My41IDExLjUgNDMuNCAxMS4zQzQyLjkgMTAuNyA0MC45IDkuOSAzOS4yIDkuN0MzNy45IDkuNSAzOC4xIDkuNSAzNy42IDlDMzcgOC42IDM2LjQgOCAzNiA3LjlDMzYgNy44IDM1LjggNy44IDM1LjcgNy43QzM1LjEgNy4zIDM0LjIgNyAzMy4xIDYuOUMzMi42IDYuNyAzMS42IDYuOSAzMSA3QzI5LjYgNy4zIDI4LjMgOCAyNy4zIDkuMkMyNi43IDkuOCAyNi4yIDEwLjggMjUuNyAxMS43QzI1LjUgMTIuMSAyNC44IDEzLjQgMjQuNyAxMy43QzI0LjYgMTMuOSAyNC41IDE0LjEgMjQuMSAxNC43QzIzLjUgMTUuNyAyMi4xIDE2LjkgMjAuNiAxNy44QzIwLjUgMTggMjAuMyAxOC4yIDIwLjEgMTguM0MxOS43IDE4LjUgMTkuNCAxOC44IDE5LjEgMTlDMTguOSAxOS4xIDE4LjcgMTkuMyAxOC41IDE5LjRDMTggMTkuOCAxNy4yIDIwLjMgMTcgMjAuNUMxNi45IDIwLjUgMTYuOCAyMC42IDE2LjcgMjAuN0MxNi4zIDIwLjggMTYuMSAyMC45IDE2IDIwLjlDMTUuNSAyMC44IDE0LjkgMjAuNSAxNC4yIDIwLjJDMTMuNyAxOS44IDEyLjcgMTguOSAxMi40IDE4LjZDMTIuMyAxOC41IDEyLjIgMTguNCAxMi4xIDE4LjJDMTEuOSAxOCAxMS4yIDE3LjEgMTEgMTYuNkMxMC45IDE2LjUgMTAuOCAxNi40IDEwLjcgMTYuM0MxMC43IDE2LjIgMTAuNiAxNi4xIDEwLjYgMTUuOUMxMC41IDE1LjkgMTAuNCAxNS43IDEwLjQgMTUuNkMxMC4zIDE1LjUgMTAuMiAxNS4yIDEwLjEgMTVDMTAgMTQuOCA5LjggMTQuNCA5LjcgMTQuMkM5LjYgMTQgOS41IDEzLjcgOS40IDEzLjZDOS40IDEzLjQgOS4zIDEzLjIgOS4yIDEzQzkuMiAxMi44IDkgMTIuNiA5IDEyLjVDOC45IDEyLjMgOC43IDEyLjEgOC43IDEyQzguNyAxMiA4LjUgMTEuNyA4LjUgMTEuN0M4LjMgMTEuMiA4LjIgMTAuOSA3LjUgMTBDNi40IDguMyA0LjIgNi40IDIuNyA1LjhDMiA1LjUgMS42IDUuNCAxLjUgNS41Wk0yOC40IDE2LjdDMjkuMiAxNi45IDI5LjcgMTcuMiAyOS45IDE3LjdDMzAuMSAxOC4yIDMwIDE4LjkgMjkuNiAxOS40QzI5LjIgMTkuOSAyOC4yIDIwLjkgMjcuNiAyMS4yQzI2LjggMjEuNyAyNS4zIDIyLjQgMjQuMiAyMi43QzIzLjkgMjIuOCAyMy42IDIyLjkgMjMuNSAyMi45QzIyLjggMjMuMiAyMC43IDIzLjcgMTkuNiAyNEMxOSAyNC4yIDE4LjQgMjQuMyAxOC4xIDI0LjRDMTcuOSAyNC40IDE2LjEgMjQuOSAxNS4zIDI1LjFDMTQuNiAyNS4yIDE0LjcgMjUuMSAxNS43IDIzLjZDMTYuNCAyMi43IDE4LjUgMjAuNiAxOS40IDE5LjlDMjAuOCAxOC44IDIxLjQgMTguNCAyMy4yIDE3LjZDMjMuOCAxNy40IDI1LjYgMTYuOCAyNS45IDE2LjhDMjUuOSAxNi44IDI2LjMgMTYuOCAyNi42IDE2LjdDMjYuOCAxNi43IDI4LjIgMTYuNyAyOC40IDE2LjdaTTMwLjQgMjAuMkMzMC41IDIwLjMgMzAuNiAyMC42IDMwLjYgMjAuN0MzMS43IDIzLjEgMzMuNCAyNC42IDM1LjYgMjUuM0MzNi4xIDI1LjUgMzYuNyAyNS43IDM3LjIgMjUuOEMzNy43IDI1LjggMzcuOCAyNS45IDM3LjggMjYuMUMzNy43IDI2LjIgMzcuNyAyNi4zIDM3LjcgMjYuNUMzNy43IDI2LjYgMzcuNyAyNi44IDM3LjYgMjdDMzcuNCAyOC41IDM2LjggMjkuOSAzNi4xIDMxQzM2LjEgMzEuMiAzNS45IDMxLjQgMzUuOSAzMS42QzM1LjcgMzEuOSAzNS4yIDMyLjYgMzQuNyAzMy4zQzMyLjYgMzUuNiAyOS43IDM3LjMgMjYuNiAzNy44QzI2LjUgMzcuOCAyNi4zIDM3LjkgMjYuMiAzNy45QzI1LjggMzcuOSAyMy43IDM3LjkgMjMuMyAzNy45QzIzLjIgMzcuOSAyMyAzNy44IDIyLjkgMzcuOEMyMS4xIDM3LjYgMTkuMyAzNi44IDE4IDM1LjdDMTcuNyAzNS40IDE3IDM0LjcgMTYuOCAzNC41QzE2LjMgMzMuOCAxNi4xIDMzIDE2LjMgMzIuNUMxNi41IDMxLjggMTYuOCAzMS42IDE3LjkgMzEuMUMxOS4xIDMwLjUgMTkuNCAzMC40IDIwLjIgMzBDMjEuNCAyOS40IDIzLjIgMjguNCAyMy45IDI3LjlDMjMuOSAyNy44IDI0LjIgMjcuNyAyNC41IDI3LjZDMjYuMyAyNi4zIDI4IDI0LjYgMjguOSAyMi45QzI5LjUgMjIuMiAyOS43IDIxLjYgMjkuOSAyMC43QzMwLjEgMjAgMzAuMiAxOS45IDMwLjQgMjAuMloiLz48L3N2Zz4K",
      page: {
        title: "Quick 登录",
        file: "login/index.html",
        service: { port: 43871, option: "loginWizardPort" }
      },
      panels: [
        {
          slot: "settings",
          file: "settings/index.html",
          title: "Amazon Quick"
        }
      ],
      options: {
        monthlyHours: 10,
        loginWizardPort: 43871,
        transport: "aidp",
        appVersion: "1.2.4660",
        region: "",
        timezone: "UTC",
        locale: "en-US",
        surface: "QUICK_WORK_DESKTOP_WINDOWS",
        requestTimeoutSeconds: 300,
        thinkingEffort: "off",
        keepSessions: false,
        outpostId: "",
        workingSessionId: ""
      }
    },
    type: "module",
    main: "./dist/amazon-quick.mjs",
    exports: {
      ".": "./dist/amazon-quick.mjs"
    },
    files: [
      "dist",
      "index.js",
      "src",
      "settings",
      "login",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES"
    ],
    license: "GPL-3.0-only",
    scripts: {
      build: "bun build index.js --target=bun --format=esm --outfile=dist/amazon-quick.mjs && bun build src/settings-panel.js --target=browser --format=iife --outfile=settings/settings.js",
      test: "node --test test/*.test.js"
    },
    devDependencies: {
      cborg: "7.0.0",
      ws: "8.23.0"
    }
  };

  // src/options.js
  var defaultOptions = Object.freeze(package_default.magpie.options);
  var regionPattern = /^[a-z]{2}(?:-[a-z0-9]+)+-[0-9]+$/;
  var versionPattern = /^\d+(?:\.\d+){1,3}(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/;
  function invalid(field, message) {
    throw Object.assign(new TypeError(message), { field });
  }
  function readOptions(options = {}) {
    const values = {};
    for (const [field, fallback] of Object.entries(defaultOptions)) {
      const value = options[field] ?? fallback;
      if (typeof value !== typeof fallback)
        invalid(field, field + " 的值类型不正确。");
      values[field] = typeof value === "string" ? value.trim() : value;
    }
    if (!Number.isFinite(values.monthlyHours * 3600000) || values.monthlyHours <= 0) {
      invalid("monthlyHours", "请输入大于 0 的有效小时数。");
    }
    if (!Number.isInteger(values.loginWizardPort) || values.loginWizardPort < 1024 || values.loginWizardPort > 65535) {
      invalid("loginWizardPort", "登录向导端口须为 1024 至 65535 的整数。");
    }
    if (!["aidp", "gateway"].includes(values.transport))
      invalid("transport", "请选择 AIDP 或 Quick Gateway。");
    if (values.appVersion.length > 64 || !versionPattern.test(values.appVersion)) {
      invalid("appVersion", "请输入 Quick App 版本号，例如 1.2.4660。");
    }
    if (values.region && !regionPattern.test(values.region))
      invalid("region", "请输入 AWS 区域代码，例如 us-east-1。");
    if (!/^[A-Za-z0-9._-]+$/.test(values.surface))
      invalid("surface", "客户端标识可使用字母、数字、点、下划线和连字符。");
    for (const key of ["outpostId", "workingSessionId"]) {
      if (!/^[\x21-\x7e]*$/.test(values[key]))
        invalid(key, "此标识只能包含不带空格的 ASCII 可见字符。");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: values.timezone });
    } catch {
      invalid("timezone", "请输入有效时区，例如 Asia/Taipei。");
    }
    try {
      values.locale = Intl.getCanonicalLocales(values.locale)[0];
    } catch {
      invalid("locale", "请输入有效语言标签，例如 zh-TW。");
    }
    if (!["off", "low", "medium", "high"].includes(values.thinkingEffort))
      invalid("thinkingEffort", "请选择有效的思考强度。");
    if (!Number.isSafeInteger(values.requestTimeoutSeconds) || values.requestTimeoutSeconds < 1 || values.requestTimeoutSeconds > 2147483) {
      invalid("requestTimeoutSeconds", "请求超时须为 1 至 2147483 秒的整数。");
    }
    return values;
  }

  // src/settings-panel.js
  var fields = document.getElementById("fields");
  var controls = fields.querySelectorAll("input[name], select[name]");
  var status = document.getElementById("status");
  async function loadSettings() {
    try {
      await magpie.ready;
      const options = await magpie.options.get();
      for (const control of controls) {
        const value = options?.[control.name] ?? defaultOptions[control.name];
        if (control.type === "checkbox")
          control.checked = value === true;
        else
          control.value = value;
      }
      fields.disabled = false;
    } catch {
      status.textContent = "读取设置失败，请重新打开面板。";
    }
  }
  fields.addEventListener("input", ({ target }) => {
    target.setCustomValidity("");
    status.textContent = "";
  });
  document.getElementById("save").addEventListener("click", async () => {
    const input = {};
    for (const control of controls) {
      if (control.type === "checkbox")
        input[control.name] = control.checked;
      else if (control.type === "number")
        input[control.name] = control.valueAsNumber;
      else
        input[control.name] = control.value;
    }
    let values;
    try {
      values = readOptions(input);
    } catch (err) {
      const field = fields.elements.namedItem(err.field);
      const advanced = field.closest("details");
      if (advanced)
        advanced.open = true;
      field.setCustomValidity(err.message);
      field.reportValidity();
      status.textContent = err.message;
      return;
    }
    fields.disabled = true;
    status.textContent = "正在保存…";
    try {
      const options = await magpie.options.get();
      await magpie.options.set({ ...options, ...values });
      status.textContent = "已保存";
    } catch {
      status.textContent = "保存失败，请重试。";
    } finally {
      fields.disabled = false;
    }
  });
  loadSettings();
})();
