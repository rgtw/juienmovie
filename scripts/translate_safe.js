/**
 * Safe Traditional Chinese translator.
 * Only converts Chinese text inside:
 *   - Single-quoted string literals: '...'
 *   - Double-quoted string literals: "..."
 *   - Template literal strings: `...`
 *   - JSX text content (text between > and <)
 * Comments and code structure are left untouched.
 */
const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

// Check if a string contains at least one CJK character
function hasChinese(str) {
  return /[\u4e00-\u9fff]/.test(str);
}

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(filePath));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(filePath);
    }
  });
  return results;
}

function translateFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let changed = false;
  
  const newLines = lines.map(line => {
    // Skip pure comment lines entirely
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return line;
    }
    
    if (!hasChinese(line)) return line;
    
    // Replace Chinese inside single-quoted strings
    let newLine = line.replace(/'([^']*[\u4e00-\u9fff][^']*)'/g, (match, inner) => {
      const converted = converter(inner);
      return `'${converted}'`;
    });
    
    // Replace Chinese inside double-quoted strings
    newLine = newLine.replace(/"([^"]*[\u4e00-\u9fff][^"]*)"/g, (match, inner) => {
      const converted = converter(inner);
      return `"${converted}"`;
    });
    
    // Replace Chinese inside template literals (simple cases only - no nested)
    newLine = newLine.replace(/`([^`]*[\u4e00-\u9fff][^`]*)`/g, (match, inner) => {
      // Don't convert ${...} expressions inside template literals
      const converted = inner.replace(/([^${}]+)/g, (part) => {
        if (hasChinese(part)) return converter(part);
        return part;
      });
      return `\`${converted}\``;
    });
    
    // Replace Chinese in JSX text content (between > and <)
    newLine = newLine.replace(/>([^<]*[\u4e00-\u9fff][^<]*)</g, (match, inner) => {
      const converted = converter(inner);
      return `>${converted}<`;
    });
    
    if (newLine !== line) changed = true;
    return newLine;
  });
  
  if (changed) {
    fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
    return true;
  }
  return false;
}

// Only translate UI-facing files (app + components + hooks)
const dirs = [
  path.join(__dirname, '..', 'src', 'app'),
  path.join(__dirname, '..', 'src', 'components'),
  path.join(__dirname, '..', 'src', 'hooks'),
];

let count = 0;
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const files = walk(dir);
  files.forEach(file => {
    // Skip API route files (server-side, backend messages)
    if (file.includes(path.sep + 'api' + path.sep)) return;
    
    try {
      if (translateFile(file)) {
        count++;
        console.log('Translated:', path.relative(process.cwd(), file));
      }
    } catch (e) {
      console.error('Error translating', file, e.message);
    }
  });
});

console.log(`\nDone. Translated ${count} files.`);
