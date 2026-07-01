// preload.js — 安全隔离层
// contextIsolation: true 时，此脚本的上下文与页面隔离
// 通过 contextBridge 暴露安全 API

const { contextBridge, ipcRenderer } = require('electron');

// 暴露桌面环境信息和安全 API 给前端
contextBridge.exposeInMainWorld('myteamDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: process.versions.electron,

  // 打开日志监控窗口
  openLogWindow: () => ipcRenderer.send('open-log-window'),

  // 监听桌面日志（可选，前端可用来显示状态）
  onLog: (callback) => {
    ipcRenderer.on('desktop-log', (e, entry) => callback(entry));
  },
});
