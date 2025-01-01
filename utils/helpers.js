const fs = require('fs');

// Helper to read JSON database
const readDatabase = (DB_FILE) => {
  const data = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(data);
};
 
// Helper to write JSON database
const writeDatabase = (DB_FILE,data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
};

const showToast = (message,toast_type) => {
  const toast = document.getElementById(`toast-${toast_type}`);
  const toastMessage = document.getElementById(`toast-message-${toast_type}`);
  toastMessage.textContent = message;
  toast.classList.remove('hidden');
  
  // Automatically hide the toast after 3 seconds
  setTimeout(() => {
      toast.classList.add('hidden');
  }, 3000);
}

module.exports = { readDatabase, writeDatabase, showToast };