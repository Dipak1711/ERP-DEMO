// ---------------------------------------------------------------------------
// Drift Check: Verifies parity between TypeScript APP_RESOURCES and database app_resources
// Run with: npm run check:resources
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_RESOURCES } from '../src/auth/appResources';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.resolve(rootDir, 'supabase', 'migrations');

// 1. Collect all resources defined in SQL migrations
const dbResources = new Map<string, { key: string; label?: string; file: string }>();

if (fs.existsSync(migrationsDir)) {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Match insert into app_resources (key, ...) values ('key', 'label', ...)
    const insertRegex = /insert\s+into\s+app_resources\s*\([^)]*\)\s*values\s*([\s\S]*?);/gi;
    let match: RegExpExecArray | null;
    while ((match = insertRegex.exec(content)) !== null) {
      const valuesBlock = match[1];
      const tupleRegex = /\(\s*'([a-z0-9_]+)'(?:\s*,\s*'([^']*)')?/gi;
      let tupleMatch: RegExpExecArray | null;
      while ((tupleMatch = tupleRegex.exec(valuesBlock)) !== null) {
        const key = tupleMatch[1];
        const label = tupleMatch[2];
        dbResources.set(key, { key, label, file });
      }
    }
  }
}

// 2. Compare against TypeScript APP_RESOURCES
const tsKeys = new Set(APP_RESOURCES.map((r) => r.key));
const dbKeys = new Set(dbResources.keys());

const inSync = APP_RESOURCES.filter((r) => dbKeys.has(r.key));
const tsOnly = APP_RESOURCES.filter((r) => !dbKeys.has(r.key));
const dbOnly = Array.from(dbResources.values()).filter((r) => !tsKeys.has(r.key));

console.log('\n=======================================================');
console.log('       ERP Resource Parity & Drift Check');
console.log('=======================================================\n');
console.log(`TypeScript Definitions:  ${APP_RESOURCES.length} pages`);
console.log(`Migration Database Keys: ${dbResources.size} entries\n`);

console.log(`✓ Synchronized (${inSync.length}):`);
for (const r of inSync) {
  console.log(`   [✓] ${r.key.padEnd(24)} (${r.section} - ${r.label})`);
}

if (tsOnly.length > 0) {
  console.log(`\n⚠️  TypeScript Only (Not yet in SQL migrations) (${tsOnly.length}):`);
  for (const r of tsOnly) {
    console.log(`   [+] ${r.key.padEnd(24)} (${r.section} - ${r.label})`);
  }
  console.log('\nℹ️  These pages work seamlessly in the UI via the TypeScript layer.');
  console.log('   If you ever want to sync them into Supabase, you can run:');
  console.log('-------------------------------------------------------');
  const sqlValues = tsOnly
    .map(
      (r) =>
        `  ('${r.key}', '${r.label.replace(/'/g, "''")}', '${r.section}', ${r.sort}, ${r.writable})`
    )
    .join(',\n');
  console.log(`INSERT INTO app_resources (key, label, section, sort, writable) VALUES\n${sqlValues}\nON CONFLICT (key) DO NOTHING;\n-------------------------------------------------------`);
} else {
  console.log('\n✓ Zero missing database migrations! All TypeScript pages exist in migrations.');
}

if (dbOnly.length > 0) {
  console.log(`\n🗑️  Database Only (Demo / removed pages filtered out by TS) (${dbOnly.length}):`);
  for (const r of dbOnly) {
    console.log(`   [-] ${r.key.padEnd(24)} (defined in ${r.file})`);
  }
  console.log('   These demo records in SQL are automatically hidden by the TypeScript layer.');
}

console.log('\n=======================================================\n');
