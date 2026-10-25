// The single application window. main.cjs reassigns it via createWindow(),
// so consumers must call getMainWindow() at use time and never capture the
// handle at require time.
let mainWindow;

function getMainWindow() {
  return mainWindow;
}

function setMainWindow(win) {
  mainWindow = win;
}

module.exports = { getMainWindow, setMainWindow };
