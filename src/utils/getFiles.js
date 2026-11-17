const fs = require('node:fs');
const path = require('node:path');

// Returns the full path of every .js file inside a folder,
// including files inside sub-folders.
function getJsFiles(directory) {
    const results = [];
    if (!fs.existsSync(directory)) return results;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            results.push(...getJsFiles(fullPath));
        } else if (entry.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

module.exports = { getJsFiles };