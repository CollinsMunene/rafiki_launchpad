const fs = require('fs');
const path = require('path');


// Helper to read JSON database
const readDatabase = (DB_FILE) => {
  const data = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(data);
};
 
// Helper to write JSON database
const writeDatabase = (DB_FILE,data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
};

module.exports = { readDatabase, writeDatabase };