// Starts the username API and `ng serve` together, and stops both on exit.
// Usage: node scripts/dev.mjs [latencyMs]   (default 600; use 2000 on stage)
import { spawn } from 'node:child_process';

const latency = process.argv[2] ?? '600';
const children = [
  spawn('node', ['server/username-api.mjs'], { stdio: 'inherit', env: { ...process.env, LATENCY_MS: latency } }),
  spawn('npx', ['ng', 'serve', '--proxy-config', 'proxy.conf.json'], { stdio: 'inherit' }),
];
console.log(`\n  Open http://localhost:4200/?latency=${latency}\n`);

const stop = (code = 0) => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
};
for (const child of children) child.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
