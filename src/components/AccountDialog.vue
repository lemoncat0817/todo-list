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

      <!-- 未登入：輸入信箱 -->
      <template v-else>
        <p class="text-sm text-ink-soft">
          登入後，這台裝置的清單會同步到雲端；換一台裝置登入同一組信箱能看到同一份清單。
        </p>
        <p class="text-xs text-ink-faint">
          不登入完全不影響使用——資料照常只存在這台瀏覽器裡，跟現在一樣。
          目前僅支援單人跨裝置同步，還沒有共享專案或指派任務給別人。
        </p>

        <form class="flex flex-col gap-2" @submit.prevent="submitEmail">
          <label class="flex flex-col gap-1.5 text-sm font-medium text-ink-soft">
            電子郵件
            <input v-model.trim="draftEmail" type="email" autocomplete="email" required
              placeholder="you@example.com"
              class="h-10 rounded-lg border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none">
          </label>

          <p v-if="auth.error" role="alert" class="text-sm text-danger-ink">{{ auth.error }}</p>

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
