#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* ignore */ }
}

const config = loadConfig();
const log = createLogger({ level: config.logLevel });
const db = await openDb(config);
await seed(db, config, log);
await db.close();
console.log('seed complete');