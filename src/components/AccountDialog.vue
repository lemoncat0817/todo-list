<template>
  <dialog ref="dialogEl"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,26rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col gap-4 p-5">
      <h2 class="text-lg font-semibold tracking-tight">帳號與同步</h2>

      <!-- 已登入：顯示狀態與登出 -->
      <template v-if="auth.status === 'signed-in'">
        <p class="text-sm text-ink-soft">
          已登入：<span class="font-medium text-ink">{{ auth.session?.user.email }}</span>
        </p>

        <p class="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-soft">
          <span v-if="sync.syncError !== null" class="text-danger-ink">
            上次同步失敗：{{ sync.syncError }}
          </span>
          <span v-else-if="sync.lastPulledAt === null">尚未完成第一次同步</span>
          <span v-else>上次同步：{{ formatTime(sync.lastPulledAt) }}</span>
        </p>

        <p class="text-xs text-ink-faint">
          同步是每 30 秒（或回到分頁、恢復網路時）拉取一次，不是即時的。
          兩台裝置幾乎同時修改同一筆時，以較晚寫入的那次為準，不會逐欄位合併。
        </p>

        <div class="flex justify-between gap-2 border-t border-line pt-3">
          <button type="button"
            class="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            @click="signOut">
            登出
          </button>
          <button type="button"
            class="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            @click="emit('close')">
            關閉
          </button>
        </div>
      </template>

      <!-- 已寄出驗證碼：等待輸入 -->
      <template v-else-if="auth.status === 'verifying'">
        <p class="text-sm text-ink-soft">
          驗證碼已寄到 <span class="font-medium text-ink">{{ auth.email }}</span>，
          請貼到下面。
        </p>

        <form class="flex flex-col gap-2" @submit.prevent="submitCode">
          <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
            六碼驗證碼
            <input v-model.trim="code" inputmode="numeric" autocomplete="one-time-code" required
              class="h-10 rounded-lg border border-line bg-surface px-3 text-base tracking-widest text-ink focus:border-accent focus:outline-none">
          </label>

          <p v-if="auth.error" role="alert" class="text-sm text-danger-ink">{{ auth.error }}</p>

          <div class="mt-1 flex justify-between gap-2">
            <button type="button"
              class="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken"
              @click="auth.cancelVerification()">
              換一個信箱
            </button>
            <button type="submit"
              class="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              :disabled="code === ''">
              驗證並登入
            </button>
          </div>
        </form>
      </template>

      <!-- 未登入：一鍵登入或信箱驗證碼 -->
      <template v-else>
        <p class="text-sm text-ink-soft">
          登入後，這台裝置的清單會同步到雲端；換一台裝置登入同一組帳號能看到同一份清單。
        </p>
        <p class="text-xs text-ink-faint">
          不登入完全不影響使用——資料照常只存在這台瀏覽器裡，跟現在一樣。
          目前僅支援單人跨裝置同步，還沒有共享專案或指派任務給別人。
        </p>

        <!-- 這裡同時是 OAuth 與信箱兩條路徑共用的錯誤提示，放在兩者之前，
             不要讓人誤以為錯誤只跟信箱表單有關 -->
        <p v-if="auth.error" role="alert" class="text-sm text-danger-ink">{{ auth.error }}</p>

        <!--
          Google／GitHub 一鍵登入的邏輯（stores/auth.ts 的 signInWithOAuthProvider、
          sync/authClient.ts 的 signInWithOAuth）已經做完並測過，OAUTH_PROVIDERS_ENABLED
          只是先不對外開放——見常數旁的註解。要重新開放只需要把它改回 true，
          不需要動任何登入邏輯。
        -->
        <template v-if="OAUTH_PROVIDERS_ENABLED">
          <div class="flex flex-col gap-2">
            <button type="button"
              class="flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface text-sm font-medium text-ink transition-colors hover:bg-sunken"
              @click="auth.signInWithOAuthProvider('google')">
              <svg viewBox="0 0 18 18" class="size-4 shrink-0" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
              </svg>
              以 Google 繼續
            </button>
            <button type="button"
              class="flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-surface text-sm font-medium text-ink transition-colors hover:bg-sunken"
              @click="auth.signInWithOAuthProvider('github')">
              <svg viewBox="0 0 16 16" class="size-4 shrink-0" aria-hidden="true" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              以 GitHub 繼續
            </button>
          </div>

          <div class="flex items-center gap-2" role="separator" aria-orientation="horizontal">
            <span class="h-px grow bg-line" />
            <span class="text-xs text-ink-faint">或</span>
            <span class="h-px grow bg-line" />
          </div>
        </template>

        <form class="flex flex-col gap-2" @submit.prevent="submitEmail">
          <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
            電子郵件
            <input v-model.trim="draftEmail" type="email" autocomplete="email" required
              placeholder="you@example.com"
              class="h-10 rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none">
          </label>

          <button type="submit"
            class="mt-1 self-end rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            :disabled="draftEmail === '' || auth.status === 'sending'">
            {{ auth.status === 'sending' ? '寄送中…' : '寄送驗證碼' }}
          </button>
        </form>
      </template>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useSyncStore } from '@/stores/sync'
import { toISODate } from '@/domain/dates'

/**
 * 帳號與同步的設定介面。
 *
 * 三個狀態（未登入／等待驗證碼／已登入）對應 stores/auth.ts 的 status，
 * 版面結構比照既有的 DataDialog.vue：原生 <dialog>，showModal 給焦點鎖定與
 * 背景 inert，不引元件庫。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

/**
 * Google／GitHub 一鍵登入暫時不對外開放（使用者要求先保留、不上線）。
 * 底層邏輯已經做完並測過（stores/auth.spec.ts、sync/authClient.ts），
 * 之後要重新開放只需要把這個常數改回 true。
 */
const OAUTH_PROVIDERS_ENABLED = false

const auth = useAuthStore()
const sync = useSyncStore()

const dialogEl = ref<HTMLDialogElement | null>(null)
const draftEmail = ref('')
const code = ref('')

watch(
  () => props.open,
  (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open) {
      code.value = ''
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  },
)

async function submitEmail(): Promise<void> {
  if (draftEmail.value === '') return
  await auth.requestMagicLink(draftEmail.value)
}

async function submitCode(): Promise<void> {
  if (code.value === '') return
  const ok = await auth.verifyCode(code.value)
  if (ok) {
    code.value = ''
    void sync.start()
  }
}

async function signOut(): Promise<void> {
  sync.stop()
  await auth.signOut()
}

function formatTime(epochMs: number): string {
  const date = new Date(epochMs)
  return `${toISODate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
</script>
