/**
 * 把 dist/ 掛在子路徑底下提供服務，模擬 GitHub Pages 的實際部署形狀
 * （https://<user>.github.io/<repo>/）。
 *
 * 這是為了持續驗證 vite.config.ts 的 base:'./' 沒有被改壞 ——
 * 若改成絕對路徑，本機根路徑測試仍會通過，但線上會全部 404。
 *
 * 用法: node scripts/serve-subpath.mjs [port] [basePath]
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.argv[2] ?? 4320)
const basePath = process.argv[3] ?? '/Vue-TodoList/'
const dist = path.resolve(fileURLToPath(new URL('../dist', import.meta.url)))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])

  if (!url.startsWith(basePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('404 — 不在 base path 之下')
  }

  let rel = url.slice(basePath.length)
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'

  const file = path.join(dist, rel)
  // 阻擋路徑穿越
  if (!file.startsWith(dist)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    return res.end('403')
  }

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // GitHub Pages 對未知路徑回 404，不做 SPA fallback ——
    // 這正是專案採用 hash 路由的原因，這裡如實模擬。
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('404')
  }

  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

server.listen(port, () => {
  console.log(`子路徑伺服器: http://localhost:${port}${basePath}`)
})
