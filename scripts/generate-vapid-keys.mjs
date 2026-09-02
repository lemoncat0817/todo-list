#!/usr/bin/env node
// 產生一組 VAPID 金鑰對，供 Web Push 使用（M4）。
//
// 不裝 web-push 套件只為了這一次性操作——VAPID 金鑰就是一組標準的
// P-256 橢圓曲線金鑰，Node 內建的 crypto 就做得到，多裝一個套件換不到
// 什麼。公鑰要編碼成未壓縮格式（0x04 開頭、65 bytes）的 base64url，
// 這是 PushManager.subscribe() 的 applicationServerKey 期待的格式；
// 私鑰只需要原始的 32-byte 純量，同樣編碼成 base64url。
//
// 每個部署環境（本地開發、正式站）都應該各自跑一次這支腳本產生自己的
// 金鑰對，不能共用——私鑰外流等於任何人都能冒充這個網站對使用者的
// 瀏覽器發送推播。
//
// 用法：node scripts/generate-vapid-keys.mjs

import { generateKeyPairSync } from 'node:crypto'

function toBase64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pubJwk = publicKey.export({ format: 'jwk' })
const privJwk = privateKey.export({ format: 'jwk' })

const uncompressedPoint = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(pubJwk.x, 'base64'),
  Buffer.from(pubJwk.y, 'base64'),
])

console.log('# 貼進 .env.local（前端讀取，公鑰本來就會送到每個瀏覽器，不是秘密）：')
console.log(`VITE_VAPID_PUBLIC_KEY=${toBase64Url(uncompressedPoint)}`)
console.log()
console.log('# 貼進 Supabase 的 Edge Function 環境變數（機密，只有伺服器端看得到）：')
console.log(`VAPID_PUBLIC_KEY=${toBase64Url(uncompressedPoint)}`)
console.log(`VAPID_PRIVATE_KEY=${toBase64Url(Buffer.from(privJwk.d, 'base64'))}`)
