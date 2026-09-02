<template>
  <div class="flex min-h-0 grow items-center justify-center px-4 py-4">
    <div class="flex w-full max-w-sm flex-col items-center gap-3 text-center">
      <template v-if="!token">
        <p class="text-sm text-ink-soft">這個連結缺少邀請代碼，請跟邀請你的人確認連結是否完整。</p>
        <RouterLink to="/today" class="text-sm font-medium text-accent hover:underline">回到待辦清單</RouterLink>
      </template>

      <template v-else-if="auth.status !== 'signed-in'">
        <p class="text-sm text-ink-soft">
          請先登入，登入完成後會自動加入邀請你的工作區——不需要重新點一次這個連結。
        </p>
        <p class="text-xs text-ink-faint">從側邊欄的「登入以同步」開始。</p>
      </template>

      <template v-else-if="phase === 'working'">
        <p class="text-sm text-ink-soft">正在加入工作區…</p>
      </template>

      <template v-else-if="phase === 'done'">
        <p class="text-sm text-ink">
          已加入「{{ workspace.currentWorkspace?.name ?? '' }}」工作區。
        </p>
        <RouterLink to="/today" class="text-sm font-medium text-accent hover:underline">前往待辦清單</RouterLink>
      </template>

      <template v-else>
        <p role="alert" class="text-sm text-danger-ink">{{ workspace.error ?? '這個邀請連結無法使用' }}</p>
        <RouterLink to="/today" class="text-sm font-medium text-accent hover:underline">回到待辦清單</RouterLink>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore, storePendingInviteToken } from '@/stores/workspace'

/**
 * 邀請連結的落地頁（#/accept-invite?token=...）。
 *
 * 還沒登入時不能直接呼叫 accept_invitation（RPC 需要一個已登入的
 * access token），把 token 存進 localStorage 再引導使用者登入——OAuth
 * 整頁導向供應商再導回來，這個元件的生命週期不會活過那趟旅程，
 * 真正消費這個 token 的地方是 stores/workspace.ts 的 auth.status
 * watcher，不是這裡；這裡登入後其實不會做任何事，是那個 watcher
 * 自動接手，見 storePendingInviteToken 的說明。
 */
const route = useRoute()
const auth = useAuthStore()
const workspace = useWorkspaceStore()

const token = computed(() => {
  const raw = route.query.token
  return typeof raw === 'string' && raw !== '' ? raw : null
})

const phase = ref<'idle' | 'working' | 'done' | 'error'>('idle')

async function run(): Promise<void> {
  if (!token.value) return
  if (auth.status !== 'signed-in') {
    storePendingInviteToken(token.value)
    return
  }
  phase.value = 'working'
  const ok = await workspace.acceptInvite(token.value)
  phase.value = ok ? 'done' : 'error'
}

watch([token, () => auth.status], () => void run(), { immediate: true })
</script>
