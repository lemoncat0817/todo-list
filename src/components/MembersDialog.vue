<template>
  <dialog ref="dialogEl"
    class="m-auto max-h-[calc(100dvh-2rem)] w-[min(92vw,32rem)] overflow-y-auto rounded-xl border border-line bg-surface p-0 text-ink shadow-lg backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    @close="emit('close')" @cancel="emit('close')">
    <div class="flex flex-col gap-4 p-5">
      <h2 class="text-lg font-semibold tracking-tight">
        {{ workspace.currentWorkspace?.name ?? '工作區成員' }}
      </h2>

      <!--
        只有在使用者不只一個工作區時才顯示切換器。跟 AppSidebar.vue
        頂端那顆是同一顆 workspace.currentWorkspaceId——切了會連帶換掉
        主畫面看到的任務／專案／標籤／篩選器，不只是換這個對話框在管理
        誰的成員名單。這裡另外放一顆純粹是方便：不用關掉對話框、去側邊欄
        切完再重新打開，就能直接管理另一個工作區的成員。
      -->
      <label v-if="workspace.workspaces.length > 1" class="flex flex-col gap-1 text-xs font-medium text-ink-faint">
        切換工作區
        <select :value="workspace.currentWorkspaceId"
          class="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none"
          @change="switchWorkspace">
          <option v-for="w in workspace.workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>
      </label>

      <p v-if="workspace.error" role="alert" class="text-sm text-danger-ink">{{ workspace.error }}</p>

      <section class="flex flex-col gap-2">
        <h3 class="text-sm font-medium text-ink-soft">成員</h3>
        <ul class="flex flex-col gap-1.5">
          <li v-for="member in workspace.members" :key="member.user_id"
            class="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
            <span class="size-2 shrink-0 rounded-full" :class="isOnline(member.user_id) ? 'bg-success' : 'bg-sunken'"
              :title="isOnline(member.user_id) ? '線上' : '離線'" aria-hidden="true" />
            <span class="min-w-0 grow truncate text-sm text-ink">
              {{ member.profiles?.display_name || '（未命名）' }}
              <span v-if="member.user_id === myUserId" class="text-ink-faint">（你）</span>
            </span>

            <template v-if="workspace.canManageMembers && member.user_id !== myUserId">
              <label class="sr-only" :for="`role-${member.user_id}`">角色</label>
              <select :id="`role-${member.user_id}`" :value="member.role"
                class="h-8 shrink-0 rounded-md border border-line bg-surface px-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                @change="changeRole(member.user_id, $event)">
                <option v-for="r in ASSIGNABLE_ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
              </select>
              <button type="button" :aria-label="`移除成員「${member.profiles?.display_name ?? member.user_id}」`"
                class="grid size-8 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger-ink"
                @click="workspace.removeMemberFromWorkspace(member.user_id)">
                <svg viewBox="0 0 16 16" class="size-4" aria-hidden="true" fill="none" stroke="currentColor"
                  stroke-width="1.5" stroke-linecap="round">
                  <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" />
                </svg>
              </button>
            </template>
            <span v-else class="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-xs text-ink-soft">
              {{ ROLE_LABELS[member.role] }}
            </span>
          </li>
        </ul>
      </section>

      <template v-if="workspace.canManageMembers">
        <section class="flex flex-col gap-2 border-t border-line pt-3">
          <h3 class="text-sm font-medium text-ink-soft">邀請新成員</h3>
          <p class="text-xs text-ink-faint">
            建立後會嘗試寄一封邀請信；不管信有沒有寄成功，都會給你一個連結，
            可以自行透過任何管道傳給對方。
          </p>

          <form class="flex gap-2" @submit.prevent="submitInvite">
            <label class="sr-only" for="invite-email">電子郵件</label>
            <input id="invite-email" v-model.trim="inviteEmail" type="email" required placeholder="you@example.com"
              class="h-9 min-w-0 grow rounded-lg border border-line bg-surface px-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none">

            <label class="sr-only" for="invite-role">角色</label>
            <select id="invite-role" v-model="inviteRole"
              class="h-9 shrink-0 rounded-lg border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none">
              <option v-for="r in ASSIGNABLE_ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
            </select>

            <button type="submit"
              class="shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              :disabled="inviteEmail === '' || inviting">
              {{ inviting ? '建立中…' : '邀請' }}
            </button>
          </form>

          <template v-if="inviteLink">
            <p v-if="emailSent" role="status" class="text-xs text-success-ink">
              邀請信已寄出。對方也可以直接用下面這個連結加入：
            </p>
            <p v-else class="text-xs text-ink-faint">
              邀請信沒有寄出（可能是這個部署還沒接寄信服務，或對方信箱暫時收不到）——
              用下面這個連結，自行傳給對方一樣可以加入：
            </p>
            <div class="flex items-center gap-2 rounded-lg bg-sunken px-2.5 py-2">
              <label class="sr-only" for="invite-link">邀請連結</label>
              <input id="invite-link" :value="inviteLink" readonly
                class="h-7 min-w-0 grow rounded border border-transparent bg-transparent px-1 text-xs text-ink-soft focus:border-accent focus:outline-none"
                @focus="($event.target as HTMLInputElement).select()">
              <button type="button"
                class="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-surface hover:text-ink"
                @click="copyInviteLink">
                {{ copied ? '已複製' : '複製' }}
              </button>
            </div>
          </template>
        </section>

        <section v-if="workspace.pendingInvitations.length > 0" class="flex flex-col gap-2 border-t border-line pt-3">
          <h3 class="text-sm font-medium text-ink-soft">等待接受的邀請</h3>
          <ul class="flex flex-col gap-1.5">
            <li v-for="invitation in workspace.pendingInvitations" :key="invitation.id"
              class="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-sm">
              <span class="min-w-0 grow truncate text-ink">{{ invitation.email }}</span>
              <span class="shrink-0 text-xs text-ink-faint">{{ ROLE_LABELS[invitation.role] }}</span>
              <button type="button" class="shrink-0 text-xs font-medium text-danger-ink hover:underline"
                @click="workspace.revoke(invitation.id)">
                撤銷
              </button>
            </li>
          </ul>
        </section>
      </template>

      <div class="flex justify-end border-t border-line pt-3">
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
import { computed, ref, watch } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
import { useAuthStore } from '@/stores/auth'
import type { MemberRole } from '@/sync/workspaceClient'

/**
 * 成員管理。版面比照 CollectionsDialog.vue：原生 <dialog>，showModal
 * 給焦點鎖定與背景 inert。
 *
 * owner 不開放透過這個畫面被指派或移除——那是移交／放棄工作區所有權，
 * 影響範圍遠大於一般成員管理，這裡刻意不做，是明確的範圍界定不是漏做。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const ASSIGNABLE_ROLES: readonly Exclude<MemberRole, 'owner'>[] = ['admin', 'member', 'commenter', 'viewer']
const ROLE_LABELS: Record<MemberRole, string> = {
  owner: '擁有者',
  admin: '管理者',
  member: '成員',
  commenter: '僅留言',
  viewer: '僅檢視',
}

const workspace = useWorkspaceStore()
const auth = useAuthStore()

const dialogEl = ref<HTMLDialogElement | null>(null)
const myUserId = computed(() => auth.session?.user.id ?? null)

/**
 * 線上狀態（M3）：workspace.onlineUserIds 是 Realtime presence 回報的
 * 集合（見 sync/realtime.ts），自己一定算在線上——用 Realtime 的
 * track() 需要等 SUBSCRIBED 狀態才會真的送出，中間有一段時間差，
 * 不能只靠那份集合判斷「我自己在不在線上」這種答案本來就已知的問題。
 */
function isOnline(userId: string): boolean {
  return userId === myUserId.value || workspace.onlineUserIds.has(userId)
}

const inviteEmail = ref('')
const inviteRole = ref<Exclude<MemberRole, 'owner'>>('member')
const inviting = ref(false)
const inviteLink = ref<string | null>(null)
const emailSent = ref(false)
const copied = ref(false)

watch(
  () => props.open,
  (open) => {
    const el = dialogEl.value
    if (!el) return
    if (open) {
      if (!el.open) el.showModal()
    } else if (el.open) {
      el.close()
    }
  },
)

function changeRole(userId: string, event: Event): void {
  const role = (event.target as HTMLSelectElement).value as MemberRole
  void workspace.changeMemberRole(userId, role)
}

function switchWorkspace(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  inviteLink.value = null
  emailSent.value = false
  copied.value = false
  void workspace.selectWorkspace(id)
}

async function submitInvite(): Promise<void> {
  if (inviteEmail.value === '') return
  inviting.value = true
  copied.value = false
  inviteLink.value = null
  emailSent.value = false
  try {
    const result = await workspace.invite(inviteEmail.value, inviteRole.value)
    if (result !== null) {
      inviteLink.value = result.link
      emailSent.value = result.emailSent
      inviteEmail.value = ''
    }
  } finally {
    inviting.value = false
  }
}

async function copyInviteLink(): Promise<void> {
  if (!inviteLink.value) return
  try {
    await navigator.clipboard.writeText(inviteLink.value)
    copied.value = true
  } catch {
    // Clipboard API 在非安全來源／使用者拒絕權限時會失敗——連結本身
    // 仍然顯示在唯讀輸入框裡，使用者可以手動選取複製，不算功能中斷
  }
}
</script>
