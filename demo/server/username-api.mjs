// Tiny username-availability API for the talk demo. Real network, real latency, so DevTools'
// Network tab shows requests going "(canceled)" when the validator aborts them.
// GET /api/username?u=<name>  →  { "available": boolean }   (after LATENCY_MS)
import { createServer } from 'node:http';

const PORT = 4312;
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 600); // `npm run stage` uses 2000
const TAKEN = new Set(['admin', 'angular', 'giorgio']); // keep in sync with src/app/spike/taken.ts
const FAILING = 'offline'; // answers 503, to show onError

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  if (url.pathname !== '/api/username') {
    res.writeHead(404).end();
    return;
  }
  const username = url.searchParams.get('u') ?? '';
  console.log(`[api] ← ${username}`);
  const timer = setTimeout(() => {
    if (username === FAILING) {
      console.log(`[api] → ${username} (503)`);
      res.writeHead(503).end();
      return;
    }
    console.log(`[api] → ${username}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ available: !TAKEN.has(username) }));
  }, LATENCY_MS);
  res.on('close', () => {
    if (!res.writableEnded) {
      clearTimeout(timer);
      console.log(`[api] ✕ ${username} (client aborted)`);
    }
  });
})
  .on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `[api] port ${PORT} is busy: another demo server is still running (lsof -ti :${PORT} | xargs kill)` : err);
    process.exit(1);
  })
  .listen(PORT, () => console.log(`[api] username API on http://localhost:${PORT} (latency ${LATENCY_MS} ms)`));
