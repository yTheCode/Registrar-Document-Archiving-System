// File paths the user picked via the open-file dialog this session.
// Same Set instance forever: consumers mutate it, never reassign it.
const sessionPickedFiles = new Set();

module.exports = { sessionPickedFiles };
