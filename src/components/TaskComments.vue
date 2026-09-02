<template>
  <fieldset class="flex flex-col gap-2 rounded-lg border border-line p-3">
    <legend class="px-1 text-sm font-medium text-ink-soft">留言</legend>

    <p v-if="list.length === 0" class="text-sm text-ink-faint">還沒有人留言</p>
    <ul v-else class="flex flex-col gap-3">
      <li v-for="comment in list" :key="comment.id" class="flex flex-col gap-1">
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-medium text-ink">{{ authorName(comment.authorId) }}</span>
          <span class="text-xs text-ink-faint">{{ formatTimestamp(comment.createdAt) }}</span>
          <span v-if="comment.updatedAt > comment.createdAt" class="text-xs text-ink-faint">（已編輯）</span>
        </div>

        <template v-if="editingId === comment.id">
          <label class="sr-only" :for="`edit-comment-${comment.id}`">編輯留言</label>
          <textarea :id="`edit-comment-${comment.id}`" v-model="editingBody" rows="2"
            class="min-h-14 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[15px] text-ink focus:border-accent focus:outline-none" />
          <div class="flex gap-2">
            <button type="button"
              class="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              :disabled="editingBody.trim() === ''" @click="saveEdit">儲存</button>
            <button type="button"
              class="rounded-md px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-sunken"
              @click="cancelEdit">取消</button>
          </div>
        </template>
        <template v-else>
          <p class="whitespace-pre-wrap text-[15px] text-ink">{{ comment.body }}</p>
          <div v-if="comment.authorId === myUserId" class="flex gap-3">
            <button type="button" class="text-xs text-ink-faint transition-colors hover:text-ink"
              @click="startEdit(comment)">編輯</button>
            <button type="button" class="text-xs text-ink-faint transition-colors hover:text-danger-ink"
              @click="comments.remove(comment.id)">刪除</button>
          </div>
        </template>
      </li>
    </ul>

    <div class="flex flex-col gap-1.5 pt-1">
      <label class="sr-only" :for="`new-comment-${taskId}`">新增留言</label>
      <textarea :id="`new-comment-${taskId}`" v-model="draft" rows="2" placeholder="留個話…"
        class="min-h-14 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none" />
      <button type="button"
        class="self-end rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        :disabled="draft.trim() === ''" @click="submit">留言</button>
    </div>
  </fieldset>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCommentsStore } from '@/stores/comments'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import type { StoredComment } from '@/db/schema'

/**
 * 任務留言區——只有在已設定同步且已登入時，容器（TaskDetailForm.vue）
 * 才會渲染這個元件：留言是「跟別人對話」，純本機模式下沒有別人可以
 * 對話，不顯示一個永遠空著的留言區。
 */
const props = defineProps<{ taskId: string }>()

const comments = useCommentsStore()
const auth = useAuthStore()
const workspace = useWorkspaceStore()

const list = computed(() => comments.forTask(props.taskId))
const myUserId = computed(() => auth.session?.user.id ?? null)

/**
 * 作者名稱靠 workspace.members 解析——跟 MembersDialog.vue 同一份資料，
 * 不另外打 API：那份清單本來就會在登入、以及切換工作區時載入目前
 * 工作區的成員列表，留言的作者只可能是「這個任務所屬工作區的成員」
 * （can_comment() 就是這樣把關的），不需要為了留言另外查一次。
 * 成員清單裡找不到時，代表對方已經離開這個工作區——留言仍然留著
 * （不因為作者退出就消失），只是顯示不出目前的名字。
 */
function authorName(authorId: string): string {
  if (authorId === myUserId.value) return '我'
  const member = workspace.members.find((m) => m.user_id === authorId)
  if (!member) return '已離開的成員'
  return member.profiles?.display_name || '（未命名）'
}

function formatTimestamp(ms: number): string {
  return new Intl.DateTimeFormat('zh-Hant', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ms))
}

const draft = ref('')
function submit(): void {
  const body = draft.value.trim()
  if (body === '') return
  comments.add(props.taskId, body)
  draft.value = ''
}

const editingId = ref<string | null>(null)
const editingBody = ref('')
function startEdit(comment: StoredComment): void {
  editingId.value = comment.id
  editingBody.value = comment.body
}
function cancelEdit(): void {
  editingId.value = null
  editingBody.value = ''
}
function saveEdit(): void {
  const body = editingBody.value.trim()
  if (body === '' || editingId.value === null) return
  comments.update(editingId.value, body)
  cancelEdit()
}
</script>
