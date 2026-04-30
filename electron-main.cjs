'use strict';

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('force_high_performance_gpu');

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 590,
    useContentSize: true,
    autoHideMenuBar: true,
    backgroundColor: '#aeb6bf',
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
};

app.whenReady().then(() => {
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
