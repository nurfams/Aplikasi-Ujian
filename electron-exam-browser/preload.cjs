const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronExam", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  testConfig: (config) => ipcRenderer.invoke("config:test", config),
  startExam: () => ipcRenderer.invoke("exam:start"),
  openConfig: () => ipcRenderer.invoke("exam:open-config"),
  exit: () => ipcRenderer.invoke("exam:exit"),
  onFocusLost: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("exam:focus-lost", listener);
    return () => ipcRenderer.removeListener("exam:focus-lost", listener);
  },
  onError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("exam:error", listener);
    return () => ipcRenderer.removeListener("exam:error", listener);
  }
});
