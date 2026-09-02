/*
 * Service worker：讓這個純前端工具可以離線使用、也可以安裝到桌面。
 *
 * 策略是「網路優先、失敗才回快取」，而不是常見的「快取優先」。
 * 快取優先在這裡是錯的選擇：資產檔名有雜湊、index.html 沒有，
 * 快取優先會讓使用者在部署後仍然拿到舊的 index.html，
 * 而它引用的舊資產可能已經不存在——畫面會白掉，而且清不掉。
 *
 * 手寫而不是引 workbox：這裡需要的行為只有三十行，
 * 而本專案對每一個相依都算過 gzip 成本。
 */
const CACHE = 'todo-list-v1'

self.addEventListener('install', (event) => {
  // 不預先快取任何東西：資產檔名帶雜湊，建置時才知道，
  // 硬寫一份清單只會在下次建置後失效。第一次瀏覽時自然會填滿。
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

/**
 * M4：被 @提及時顯示的推播通知。payload 由
 * supabase/functions/send-mention-push 送出，形狀是
 * { title, body, taskId }——這裡不解析留言內容本身，伺服器端已經把
 * 摘要準備好了。
 *
 * tag 設成 taskId：同一筆任務短時間內被多次提及只會疊成同一則通知
 * 更新內容，不會洗版通知中心。
 */
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    return
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || '通知', {
      body: payload.body || '',
      tag: payload.taskId || undefined,
      data: { taskId: payload.taskId ?? null },
    }),
  )
})

/**
 * 點通知只是把使用者帶回應用程式本身，不是導去那一筆任務——這個工具
 * 目前沒有「用網址直接開某一筆任務詳情」的深連結機制（TaskDetailPanel／
 * TaskDetailDialog 都是點清單裡的列才開，不是靠路由），要做到「點通知
 * 直接跳到那筆任務」得先有這個深連結機制，不是這裡能力所及，先誠實把
 * 使用者帶回應用程式本身。已經開著的分頁優先切過去，不是每次都開新分頁。
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const existing = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of existing) {
        if ('focus' in client) {
          await client.focus()
          return
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow('./')
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // 只處理自己的 GET：POST 之類的請求快取起來沒有意義，
  // 跨來源的資源也不該由我們代管。
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        // 只快取成功的回應：把 404 存起來會讓錯誤變成永久的
        if (response.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(request, response.clone())
        }
        return response
      } catch (error) {
        const cached = await caches.match(request)
        if (cached) return cached
        throw error
      }
    })(),
  )
})
