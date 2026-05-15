const fs = require('fs');
const path = require('path');
const OpenCC = require('opencc-js');

const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

// target dirs
const dirs = ['./src/app', './src/components'];

dirs.forEach(dir => {
  const files = walk(dir);
  files.forEach(file => {
    try {
      const content = fs.readFileSync(file, 'utf8');
      
      // Basic regex to find strings containing Chinese characters inside tags or quotes
      // To be safe, we will just convert the whole file, but it might break APIs expecting simplified Chinese.
      // E.g., Douban categories '热门', '全部'. Let's convert the file and then revert known API keywords.
      
      let converted = converter(content);
      
      // Revert known API strings
      converted = converted.replace(/熱門/g, '热门');
      converted = converted.replace(/全部/g, '全部');
      converted = converted.replace(/cmliussss-cdn/g, 'cmliussss-cdn');
      converted = converted.replace(/doubanDataSource/g, 'doubanDataSource');
      
      if (content !== converted) {
        fs.writeFileSync(file, converted, 'utf8');
      }
    } catch (e) {
      console.error(e);
    }
  });
});

console.log('Translation complete.');
