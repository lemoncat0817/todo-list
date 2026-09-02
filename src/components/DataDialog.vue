<template>
  <dialog ref="dialogEl"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,32rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col gap-5 p-5">
      <h2 class="text-lg font-semibold tracking-tight">資料與提醒</h2>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">備份</h3>
        <p class="text-sm text-ink-faint">
          資料只存在這一台裝置的瀏覽器裡。清除瀏覽資料就會全部消失，
          換一台機器也帶不過去——所以請定期匯出一份。
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button"
            class="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            @click="exportBackup">
            匯出 JSON
          </button>
          <span class="self-center text-sm tabular-nums text-ink-faint">
            目前 {{ tasks.items.length }} 筆任務
          </span>
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">還原</h3>

        <fieldset class="flex flex-col gap-1.5">
          <legend class="sr-only">匯入方式</legend>
          <label class="flex items-start gap-2 text-[15px] text-ink">
            <input v-model="mode" type="radio" value="merge" class="mt-1 size-4 accent-accent">
            <span>
              合併
              <span class="block text-xs text-ink-faint">同一筆以匯入的版本為準，其餘保留</span>
            </span>
          </label>
          <label class="flex items-start gap-2 text-[15px] text-ink">
            <input v-model="mode" type="radio" value="replace" class="mt-1 size-4 accent-accent">
            <span>
              取代
              <span class="block text-xs text-ink-faint">先清空目前的資料，再匯入</span>
            </span>
          </label>
        </fieldset>

        <label class="sr-only" for="import-file">選擇備份檔</label>
        <input id="import-file" type="file" accept="application/json,.json"
          class="text-sm text-ink-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-sunken"
          @change="importBackup">

        <p v-if="importMessage !== null" :role="importFailed ? 'alert' : 'status'"
          class="rounded-lg px-3 py-2 text-sm"
          :class="importFailed ? 'bg-danger-soft text-danger-ink' : 'bg-success-soft text-success-ink'">
          {{ importMessage }}
        </p>

        <p class="text-xs text-ink-faint">
          匯入後可以用 <span class="font-mono">Ctrl</span>/<span class="font-mono">Cmd</span> +
          <span class="font-mono">Z</span> 復原。
        </p>
      </section>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">到期提醒</h3>

        <p v-if="permission === 'unsupported'" class="text-sm text-ink-faint">
          這個瀏覽器不支援通知。
        </p>
        <p v-else-if="permission === 'denied'" class="text-sm text-ink-faint">
          通知已被瀏覽器封鎖。需要到瀏覽器的網站設定裡重新允許。
        </p>
        <label v-else class="flex items-center gap-2 text-[15px] text-ink">
          <input type="checkbox" :checked="prefs.remindersEnabled" class="size-4 accent-accent"
            @change="toggleReminders">
          有到期時間的任務到點時通知我
        </label>

        <p class="text-xs text-ink-faint">
          這是純前端工具，沒有伺服器，所以<strong class="font-medium text-ink-soft">只有在這個分頁開著的時候</strong>才會提醒。
          分頁關掉就不會響。
        </p>
      </section>

      <!--
        只有設定了 VITE_VAPID_PUBLIC_KEY（見 .env.local.example）才顯示——
        沒接這塊的使用者（含所有沒接同步的純本機使用者）看到的是完全
        正常、沒有殘缺的畫面，不是一個點了會壞掉的開關。
      -->
      <section v-if="isPushConfigured" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">推播通知</h3>

        <p v-if="auth.status !== 'signed-in'" class="text-sm text-ink-faint">登入後才能開啟。</p>
        <p v-else-if="push.isIosNotStandalone" class="text-sm text-ink-faint">
          iOS 上要先把這個網站加到主畫面（分享→加入主畫面）才能開啟推播通知，
          Safari 分頁裡沒有這個功能。
        </p>
        <p v-else-if="!push.supported" class="text-sm text-ink-faint">這個瀏覽器不支援推播通知。</p>
        <p v-else-if="push.permission === 'denied'" class="text-sm text-ink-faint">
          通知已被瀏覽器封鎖。需要到瀏覽器的網站設定裡重新允許。
        </p>
        <label v-else class="flex items-center gap-2 text-[15px] text-ink">
          <input type="checkbox" :checked="push.subscribed" :disabled="push.loading" class="size-4 accent-accent"
            @change="togglePush">
          分頁關閉時也用推播通知我
        </label>

        <p v-if="push.error" role="alert" class="text-xs text-danger-ink">{{ push.error }}</p>
        <p class="text-xs text-ink-faint">
          跟上面的到期提醒不同，這個<strong class="font-medium text-ink-soft">分頁關掉也收得到</strong>——實際會通知
          哪些事件，由下面的「通知偏好」決定。
        </p>
      </section>

      <!--
        通知偏好獨立於推播開關：這裡決定的是「這一類事件要不要被記錄、
        要不要推播」，即使瀏覽器推播沒開（isPushConfigured 為 false，
        或使用者沒訂閱），關掉某一類一樣會讓通知中心不再出現那一類。
      -->
      <section v-if="isSyncConfigured && auth.status === 'signed-in'" class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">通知偏好</h3>

        <label class="flex items-center gap-2 text-[15px] text-ink">
          <input type="checkbox" :checked="notifications.prefs.notifyOnMention" class="size-4 accent-accent"
            @change="notifications.setPref({ notifyOnMention: ($event.target as HTMLInputElement).checked })">
          被留言 @提及時通知我
        </label>
        <label class="flex items-center gap-2 text-[15px] text-ink">
          <input type="checkbox" :checked="notifications.prefs.notifyOnAssignment" class="size-4 accent-accent"
            @change="notifications.setPref({ notifyOnAssignment: ($event.target as HTMLInputElement).checked })">
          被指派任務時通知我
        </label>
        <label class="flex items-center gap-2 text-[15px] text-ink">
          <input type="checkbox" :checked="notifications.prefs.dailyDigestEnabled" class="size-4 accent-accent"
            @change="notifications.setPref({ dailyDigestEnabled: ($event.target as HTMLInputElement).checked })">
          每天寄一封摘要信
        </label>

        <p v-if="notifications.error" role="alert" class="text-xs text-danger-ink">{{ notifications.error }}</p>
      </section>

      <div class="flex justify-end">
        <button type="button"
          class="rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          @click="emit('close')">
          關閉
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { backupFilename, parseBackup, serializeBackup } from '@/db/backup'
import { useTasksStore } from '@/stores/tasks'
import { useCollectionsStore } from '@/stores/collections'
import { usePrefsStore } from '@/stores/prefs'
import { useDueReminders } from '@/composables/useDueReminders'
import { useAuthStore } from '@/stores/auth'
import { usePushStore } from '@/stores/push'
import { useNotificationsStore } from '@/stores/notifications'
import { isPushConfigured, isSyncConfigured } from '@/sync/config'

/**
 * 資料與提醒。
 *
 * 匯出放在最前面而不是最後：純前端工具最容易失去的就是資料，
 * 而使用者通常不會主動去翻設定找備份功能。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const tasks = useTasksStore()
const collections = useCollectionsStore()
const prefs = usePrefsStore()
const reminders = useDueReminders()
const auth = useAuthStore()
const push = usePushStore()
const notifications = useNotificationsStore()

const dialogEl = ref<HTMLDialogElement | null>(null)
const mode = ref<'merge' | 'replace'>('merge')
const importMessage = ref<string | null>(null)
const importFailed = ref(false)
const permission = ref(reminders.permission())

watch(
  () => props.open,
  (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open) {
      importMessage.value = null
      permission.value = reminders.permission()
      if (isPushConfigured) void push.refresh()
      if (isSyncConfigured && auth.status === 'signed-in') void notifications.refreshPrefs()
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  },
)

function exportBackup(): void {
  const json = serializeBackup({
    tasks: tasks.items,
    projects: collections.projects,
    tags: collections.tags,
    filters: collections.filters,
  })
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = backupFilename()
  link.click()
  // 不釋放的話這份 blob 會留在記憶體裡直到分頁關閉
  URL.revokeObjectURL(url)
}

async function importBackup(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const parsed = parseBackup(await file.text())
  // 讀完就清空，否則選同一個檔案第二次不會觸發 change
  input.value = ''

  if (!parsed.ok) {
    importFailed.value = true
    importMessage.value = parsed.message
    return
  }

  const { data, skipped } = parsed.result
  tasks.importBackup(data, mode.value)

  const skippedTotal = skipped.tasks + skipped.projects + skipped.tags + skipped.filters
  importFailed.value = false
  importMessage.value =
    `已匯入 ${data.tasks.length} 筆任務、${data.projects.length} 個專案、` +
    `${data.tags.length} 個標籤、${data.filters.length} 個篩選器。` +
    // 濾掉的資料一定要說：默默吃掉會讓使用者以為東西還在
    (skippedTotal > 0 ? `有 ${skippedTotal} 筆格式不符已略過。` : '')
}

async function toggleReminders(event: Event): Promise<void> {
  const wantsOn = (event.target as HTMLInputElement).checked
  if (!wantsOn) {
    reminders.disable()
    return
  }
  await reminders.enable()
  permission.value = reminders.permission()
}

async function togglePush(event: Event): Promise<void> {
  const wantsOn = (event.target as HTMLInputElement).checked
  if (wantsOn) await push.enable()
  else await push.disable()
}
</script>
