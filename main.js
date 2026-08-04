const { app, BrowserWindow } = require('electron');
const path = require('path');

// Start the Express backend server
require('./server.js');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    title: "PharmTrack Inventory Management System"
  });

  // Since the Express server starts asynchronously (connectDB takes a bit),
  // we poll global.expressPort until it is set, then load the URL.
  const interval = setInterval(() => {
    if (global.expressPort) {
      clearInterval(interval);
      mainWindow.loadURL(`http://localhost:${global.expressPort}`);
      console.log(`Loaded URL: http://localhost:${global.expressPort}`);
    }
  }, 100);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
