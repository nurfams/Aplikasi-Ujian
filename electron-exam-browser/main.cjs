const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const EXAM_CLIENT_ID = process.env.EXAM_CLIENT_ID || "sman94-exam-browser";
const EXAM_CLIENT_KEY = process.env.EXAM_CLIENT_KEY || "dev-exam-client-key";
const CONFIG_FILE = "electron-exam-browser-config.json";
const APP_NAME = "CBT SMAN 94 Exam Browser";

let mainWindow;
let currentConfig;
let securityReady = false;

function defaultConfig() {
  return {
    schoolName: "CBT SMAN 94",
    webProtocol: "http",
    webHost: "127.0.0.1",
    webPort: 5173,
    apiPort: 4100,
    kioskMode: true,
    blockDevTools: true
  };
}

function configPath() {
  return path.join(app.getPath("userData"), CONFIG_FILE);
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    return normalizeConfig(parsed);
  } catch {
    return defaultConfig();
  }
}

function normalizeConfig(config = {}) {
  const fallback = defaultConfig();
  const webProtocol = config.webProtocol === "https" ? "https" : "http";
  const webHost = String(config.webHost || fallback.webHost).trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || fallback.webHost;
  const webPort = Math.max(1, Math.min(65535, Number(config.webPort || fallback.webPort)));
  const apiPort = Math.max(1, Math.min(65535, Number(config.apiPort || fallback.apiPort)));
  return {
    schoolName: String(config.schoolName || fallback.schoolName).trim() || fallback.schoolName,
    webProtocol,
    webHost,
    webPort,
    apiPort,
    kioskMode: config.kioskMode !== false,
    blockDevTools: config.blockDevTools !== false
  };
}

function writeConfig(config) {
  const next = normalizeConfig(config);
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  currentConfig = next;
  return next;
}

function webBaseUrl(config = currentConfig) {
  const port = Number(config.webPort);
  const portPart = port && !((config.webProtocol === "http" && port === 80) || (config.webProtocol === "https" && port === 443))
    ? `:${port}`
    : "";
  return `${config.webProtocol}://${config.webHost}${portPart}/`;
}

function apiBaseUrl(config = currentConfig) {
  const port = Number(config.apiPort);
  const portPart = port && !((config.webProtocol === "http" && port === 80) || (config.webProtocol === "https" && port === 443))
    ? `:${port}`
    : "";
  return `${config.webProtocol}://${config.webHost}${portPart}/api`;
}

function setupNetworkGuards(config) {
  if (securityReady) return;
  securityReady = true;

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const requestUrl = new URL(details.url);
      const appUrl = new URL(webBaseUrl(currentConfig));
      if (requestUrl.hostname === appUrl.hostname && requestUrl.pathname.startsWith("/api/") && Number(requestUrl.port || 80) !== Number(currentConfig.apiPort)) {
        const target = new URL(apiBaseUrl(currentConfig));
        target.pathname = requestUrl.pathname;
        target.search = requestUrl.search;
        callback({ redirectURL: target.toString() });
        return;
      }
    } catch {
      // Allow malformed/non-http internal requests to continue.
    }
    callback({});
  });

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    headers["x-cbt-exam-client"] = EXAM_CLIENT_ID;
    headers["x-cbt-exam-client-key"] = EXAM_CLIENT_KEY;
    headers["x-cbt-exam-platform"] = "windows-electron";
    callback({ requestHeaders: headers });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = new Set(["fullscreen"]);
    callback(allowed.has(permission));
  });
}

function injectClientGuards(window) {
  window.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const ctrlOrMeta = input.control || input.meta;
    const blockedKeys = new Set(["f5", "f11", "f12", "escape"]);
    const blockedCombos = ctrlOrMeta && ["r", "w", "q", "n", "t", "l", "p", "s", "u", "i", "j"].includes(key);
    const altBlocked = input.alt && ["tab", "f4", "left", "right"].includes(key);
    if (blockedKeys.has(key) || blockedCombos || altBlocked) {
      event.preventDefault();
    }
  });

  window.webContents.on("context-menu", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedUrl(url)) return;
    event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, _code, description, validatedUrl) => {
    if (!validatedUrl.startsWith("file://")) {
      mainWindow?.webContents.send("exam:error", `Gagal membuka server: ${description}`);
    }
  });
}

function isAllowedUrl(url) {
  try {
    const target = new URL(url);
    const web = new URL(webBaseUrl(currentConfig));
    const api = new URL(apiBaseUrl(currentConfig));
    return target.protocol === "file:" || target.hostname === web.hostname || target.hostname === api.hostname;
  } catch {
    return false;
  }
}

function createMainWindow() {
  currentConfig = readConfig();
  setupNetworkGuards(currentConfig);
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: APP_NAME,
    autoHideMenuBar: true,
    backgroundColor: "#eaf0f6",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !currentConfig.blockDevTools
    }
  });

  injectClientGuards(mainWindow);
  loadConfigScreen();

  mainWindow.on("blur", () => {
    mainWindow?.webContents.send("exam:focus-lost");
  });
}

function loadConfigScreen() {
  if (!mainWindow) return;
  mainWindow.setKiosk(false);
  mainWindow.setFullScreen(false);
  mainWindow.loadFile(path.join(__dirname, "config.html"));
}

async function loadExam() {
  if (!mainWindow) return;
  const url = webBaseUrl(currentConfig);
  if (currentConfig.kioskMode) {
    mainWindow.setFullScreen(true);
    mainWindow.setKiosk(true);
  }
  await mainWindow.loadURL(url);
}

ipcMain.handle("config:get", () => ({
  config: currentConfig || readConfig(),
  webUrl: webBaseUrl(currentConfig || readConfig()),
  apiUrl: apiBaseUrl(currentConfig || readConfig())
}));

ipcMain.handle("config:save", (_event, config) => {
  const next = writeConfig(config);
  return {
    config: next,
    webUrl: webBaseUrl(next),
    apiUrl: apiBaseUrl(next)
  };
});

ipcMain.handle("config:test", async (_event, config) => {
  const next = normalizeConfig(config);
  const url = `${apiBaseUrl(next)}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "x-cbt-exam-client": EXAM_CLIENT_ID,
        "x-cbt-exam-client-key": EXAM_CLIENT_KEY,
        "x-cbt-exam-platform": "windows-electron"
      }
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, url, data };
  } catch (error) {
    return { ok: false, url, message: error.message };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle("exam:start", async () => {
  await loadExam();
  return { ok: true };
});

ipcMain.handle("exam:open-config", () => {
  loadConfigScreen();
  return { ok: true };
});

ipcMain.handle("exam:exit", async () => {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Keluar Exam Browser",
    message: "Keluar dari aplikasi Exam Browser?",
    detail: "Pastikan peserta sudah logout atau ujian sudah selesai.",
    buttons: ["Batal", "Keluar"],
    defaultId: 0,
    cancelId: 0
  });
  if (choice.response === 1) app.quit();
  return { ok: false };
});

app.whenReady().then(createMainWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
