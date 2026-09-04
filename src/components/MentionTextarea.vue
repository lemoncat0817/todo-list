<template>
  <div class="relative">
    <label class="sr-only" :for="id">{{ label }}</label>
    <textarea :id="id" ref="textareaEl" :value="modelValue" :rows="rows" :placeholder="placeholder"
      class="min-h-14 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      @input="onInput" @keydown="onKeydown" @blur="closeSuggestions" />

    <ul v-if="suggestions.length > 0"
      class="absolute z-10 mt-1 max-h-40 w-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
      <li v-for="(member, i) in suggestions" :key="member.userId">
        <button type="button"
          class="block w-full px-2.5 py-1.5 text-left text-[15px] text-ink transition-colors hover:bg-sunken"
          :class="{ 'bg-accent-soft': i === activeIndex }"
          @mousedown.prevent="pick(member)">
          {{ member.displayName }}
        </button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { suggestMentions, type MentionableMember } from '@/domain/mentions'

/**
 * 帶 @提及自動完成的文字輸入框。抽出來是因為新增留言與編輯留言兩個
 * 輸入框需要同一套「打 @ 就跳出成員清單」邏輯，重複寫兩份容易在其中
 * 一處漏改。不用 v-html／contenteditable：純文字 textarea 選字、
 * 貼上、輸入法組字都是瀏覽器原生行為，contenteditable 這些全部要自己
 * 重新處理，換不到的複雜度不值得為了插入一個 @提及的 UI 冒。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    id: string
    label: string
    members: readonly MentionableMember[]
    rows?: number
    placeholder?: string
  }>(),
  { rows: 2, placeholder: '' },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const textareaEl = ref<HTMLTextAreaElement | null>(null)
const suggestions = ref<MentionableMember[]>([])
const activeIndex = ref(0)
let range: { start: number; end: number } | null = null

function refreshSuggestions(): void {
  const el = textareaEl.value
  if (!el) return
  const result = suggestMentions(el.value, el.selectionStart, props.members)
  if (!result || result.suggestions.length === 0) {
    closeSuggestions()
    return
  }
  range = result.range
  suggestions.value = result.suggestions
  activeIndex.value = 0
}

function closeSuggestions(): void {
  suggestions.value = []
  range = null
}

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  refreshSuggestions()
}

function pick(member: MentionableMember): void {
  const el = textareaEl.value
  if (!el || !range) return
  const value = el.value
  const start = range.start
  const next = `${value.slice(0, range.start)}@${member.displayName} ${value.slice(range.end)}`
  emit('update:modelValue', next)
  closeSuggestions()
  // 插入完直接把游標放在插入內容之後，不用使用者自己再點一次繼續打字。
  // range 在上面 closeSuggestions() 已經被清成 null，游標位置要用先存的 start。
  const cursor = start + member.displayName.length + 2
  requestAnimationFrame(() => el.setSelectionRange(cursor, cursor))
}

function onKeydown(event: KeyboardEvent): void {
  if (suggestions.value.length === 0) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % suggestions.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + suggestions.value.length) % suggestions.value.length
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    const member = suggestions.value[activeIndex.value]
    if (member) {
      event.preventDefault()
      pick(member)
    }
  } else if (event.key === 'Escape') {
    closeSuggestions()
  }
}

defineExpose({ focus: () => textareaEl.value?.focus() })
</script>
