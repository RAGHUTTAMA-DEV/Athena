import * as fs from 'fs';
import * as path from 'path';

const FORBIDDEN_IMPORTS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'vue',
  'svelte',
  '@angular/core',
  'solid-js',
  'preact'
];

function scanDirectory(dir: string): { file: string; forbidden: string }[] {
  const violations: { file: string; forbidden: string }[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
        violations.push(...scanDirectory(fullPath));
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      for (const forbidden of FORBIDDEN_IMPORTS) {
        // Regex for from 'forbidden' or require('forbidden')
        const regex = new RegExp(`from\\s+['"]${forbidden}['"]|require\\(['"]${forbidden}['"]\\)`, 'i');
        if (regex.test(content)) {
          violations.push({ file: fullPath, forbidden });
        }
      }
    }
  }

  return violations;
}

export function verifyUiIndependence(): boolean {
  const srcDir = path.resolve('./src');
  const violations = scanDirectory(srcDir);
  if (violations.length > 0) {
    console.error('❌ UI Independence Violation Detected:');
    for (const v of violations) {
      console.error(`   ${v.file} imports forbidden frontend package "${v.forbidden}"`);
    }
    return false;
  }
  return true;
}
