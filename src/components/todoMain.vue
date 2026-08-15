<template>
  <div class="w-full h-[450px] flex flex-col">
    <nav class="w-full h-[50px] flex justify-center items-center shrink-0">
      <!-- 稽核 P5：選取中原本是 white on yellow-400 = 1.53:1（axe 實測），
           改為 black on yellow-400 = 13.71:1；未選取由 blue-500 (3.67) 改為 blue-700 (6.70)。 -->
      <RouterLink v-for="tab in FILTERS" :key="tab.filter" :to="tab.path"
        :aria-current="tab.filter === props.filter ? 'page' : undefined"
        class="w-20 h-4/5 border-white border-solid border-2 rounded-lg text-center leading-[40px] text-lg font-bold mx-2 cursor-pointer select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        :class="tab.filter === props.filter
          ? 'bg-yellow-400 text-black'
          : 'bg-blue-700 text-white hover:bg-blue-800 active:bg-blue-900'">{{ tab.label }}</RouterLink>
    </nav>

    <div class="w-4/5 grow m-auto overflow-y-auto min-h-0">
      <!-- 資料改由 IndexedDB 非同步載入，載入期間必須明確表達狀態，
           否則會閃過一瞬間的空清單，看起來像資料不見了。 -->
      <p v-if="store.isLoading" role="status" aria-live="polite"
        class="text-center text-lg font-bold text-blue-900 bg-white rounded-lg py-3 px-2">載入中…</p>

      <p v-else-if="store.loadError" role="alert"
        class="text-center text-lg font-bold text-blue-900 bg-white rounded-lg py-3 px-2">
        無法載入資料，請重新整理再試一次
      </p>

      <template v-else>
        <!-- 寫入失敗時清單仍然可用，只是沒存下去 —— 用橫幅提示而非取代清單，
             否則一次存檔失敗會讓使用者以為資料全沒了。 -->
        <p v-if="store.writeError" role="alert"
          class="bg-blue-900 text-white text-center font-bold rounded-lg p-2 mb-2">
          變更尚未存檔，請確認瀏覽器儲存空間是否已滿
        </p>

        <p v-if="taskList.length === 0"
          class="text-center text-blue-900 font-bold bg-white rounded-lg py-6 px-2">
          {{ emptyMessage }}
        </p>

        <ul class="list-none m-0 p-0">
          <!-- 拖曳是純指標裝置的增強，不是唯一路徑：每一列都同時提供
               「上移／下移」按鈕，鍵盤與螢幕閱讀器使用者走那條路。
               這正是該規則要保護的東西，這裡已經滿足。 -->
          <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
          <li v-for="(item, index) in taskList" :key="item.id"
            class="w-full bg-gray-300 border-2 border-white border-solid rounded-lg p-2 mb-2 flex justify-between items-center gap-2"
            :class="{ 'ring-2 ring-blue-900': draggingId === item.id }" draggable="true"
            @dragstart="onDragStart(item.id)" @dragover.prevent @drop="onDrop(item.id)"
            @dragend="draggingId = null">
            <input :checked="item.isCompleted" type="checkbox"
              :aria-label="`標記「${item.taskName}」為已完成`" class="w-6 h-6 cursor-pointer shrink-0"
              @change="store.toggleCompleted(item.id)">

            <div class="grow min-w-0">
              <p v-if="editingId !== item.id"
                class="text-lg font-bold text-blue-900 break-all"
                :class="{ 'line-through': item.isCompleted }">
                {{ item.taskName }}
              </p>
              <input v-else :aria-label="`編輯「${item.taskName}」`" placeholder="請輸入編輯內容"
                v-model="editTaskName" @keyup.enter="saveTask(item)" @keyup.esc="cancelEdit"
                class="w-full text-blue-900 font-bold border-blue-900 border-2 border-solid rounded-lg px-1">

              <p class="flex flex-wrap gap-1 mt-1 text-xs font-bold">
                <span v-if="item.priority > 0"
                  class="bg-blue-900 text-white rounded px-1.5 py-0.5">
                  優先度 {{ PRIORITY_LABELS[item.priority] }}
                </span>
                <span v-if="item.dueDate" class="rounded px-1.5 py-0.5 text-white"
                  :class="isOverdue(item.dueDate) && !item.isCompleted ? 'bg-red-800' : 'bg-blue-700'">
                  {{ describeDue(item.dueDate) }}<template v-if="item.dueTime"> {{ item.dueTime }}</template>
                </span>
                <span v-if="item.recurrence" class="bg-green-800 text-white rounded px-1.5 py-0.5">
                  {{ describeRecurrence(item.recurrence) }}
                </span>
                <span v-for="tag in tagsOf(item)" :key="tag.id"
                  class="bg-green-800 text-white rounded px-1.5 py-0.5">#{{ tag.name }}</span>
                <span v-if="projectOf(item)" class="bg-blue-800 text-white rounded px-1.5 py-0.5">
                  {{ projectOf(item)?.name }}
                </span>
              </p>
            </div>

            <div class="shrink-0 flex items-center">
              <!-- 拖曳對鍵盤與螢幕閱讀器使用者不可用，一律同時提供按鈕路徑 -->
              <button :disabled="index === 0" :aria-label="`將「${item.taskName}」上移`"
                class="w-8 h-8 bg-blue-800 rounded-lg text-white font-bold border-2 border-solid border-black mx-0.5 disabled:opacity-40"
                @click="moveUp(index)">↑</button>
              <button :disabled="index === taskList.length - 1" :aria-label="`將「${item.taskName}」下移`"
                class="w-8 h-8 bg-blue-800 rounded-lg text-white font-bold border-2 border-solid border-black mx-0.5 disabled:opacity-40"
                @click="moveDown(index)">↓</button>
              <button v-if="editingId !== item.id" :aria-label="`編輯「${item.taskName}」`"
                class="sm:w-12 w-10 h-8 bg-red-700 rounded-lg text-white font-bold sm:text-lg border-2 border-solid border-black mx-0.5 select-none hover:bg-red-800 active:bg-red-900"
                @click="editTask(item)">編輯</button>
              <button v-else :aria-label="`保存「${item.taskName}」`"
                class="sm:w-12 w-10 h-8 bg-red-700 rounded-lg text-white font-bold sm:text-lg border-2 border-solid border-black mx-0.5 select-none hover:bg-red-800 active:bg-red-900"
                @click="saveTask(item)">保存</button>
              <button :aria-label="`刪除「${item.taskName}」`"
                class="sm:w-12 w-10 h-8 bg-red-700 rounded-lg text-white font-bold sm:text-lg border-2 border-solid border-black mx-0.5 select-none hover:bg-red-800 active:bg-red-900"
                @click="deleteTask(item.id)">刪除</button>
            </div>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useTodoTaskStore } from '@/stores/todoTask'
import { FILTERS, type TaskFilter } from '@/router/filters'
import { PRIORITY_LABELS, type StoredTask } from '@/db/schema'
import { describeDue, isOverdue } from '@/domain/dates'
import { describeRecurrence } from '@/domain/recurrence'
import { normalizeForSearch } from '@/utils/search'

// 篩選狀態由路由決定，不再存在 store 裡（原本的 pages 數字已移除）。
const props = withDefaults(defineProps<{ filter?: TaskFilter }>(), { filter: 'all' })

const store = useTodoTaskStore()

// 稽核 P1：編輯狀態是 UI 暫態，改為元件區域狀態，不再隨 todoList 被持久化。
// 這樣重新整理後一律回到閱讀狀態，原文字完好，也不會鎖住整份清單。
const editingId = ref<string | null>(null)
const editTaskName = ref('')
const draggingId = ref<string | null>(null)

const editTask = (task: StoredTask) => {
  if (editingId.value !== null) {
    alert('有待辦事項尚未保存，請先完成編輯')
    return
  }
  editingId.value = task.id
  editTaskName.value = task.taskName
}

const saveTask = (task: StoredTask) => {
  if (editTaskName.value === '') {
    alert('請輸入編輯內容')
    return
  }
  store.updateTask(task.id, { taskName: editTaskName.value })
  editingId.value = null
  editTaskName.value = ''
}

const cancelEdit = () => {
  editingId.value = null
  editTaskName.value = ''
}

const deleteTask = (id: string) => {
  // 刪掉的正好是編輯中的那筆時，一併結束編輯狀態，
  // 否則殘留的 editingId 會把其他項目鎖住。
  if (editingId.value === id) cancelEdit()
  store.removeTask(id)
}

// 稽核 P3：filter 是封閉的字面量聯集且 switch 有 default 收尾，
// 型別層面就不可能再出現「未涵蓋的值」。
const taskList = computed<StoredTask[]>(() => {
  // 稽核 P4：NFKC 正規化後比對，涵蓋大小寫與全形半形。
  const keyword = normalizeForSearch(store.keyword)
  const matched =
    keyword === ''
      ? store.todoList
      : store.todoList.filter((item) => normalizeForSearch(item.taskName).includes(keyword))

  // 只顯示頂層任務；子任務跟著父項呈現
  const top = matched.filter((item) => item.parentId === null)
  const sorted = [...top].sort((a, b) => a.order - b.order)

  switch (props.filter) {
    case 'active':
      return sorted.filter((item) => !item.isCompleted)
    case 'completed':
      return sorted.filter((item) => item.isCompleted)
    default:
      return sorted
  }
})

const emptyMessage = computed(() => {
  if (store.keyword !== '') return `找不到符合「${store.keyword}」的代辦事項`
  switch (props.filter) {
    case 'active':
      return '沒有未完成的代辦事項'
    case 'completed':
      return '還沒有已完成的代辦事項'
    default:
      return '目前沒有代辦事項，從上方新增一筆吧'
  }
})

const tagsOf = (task: StoredTask) => store.tags.filter((t) => task.tagIds.includes(t.id))
const projectOf = (task: StoredTask) => store.projects.find((p) => p.id === task.projectId) ?? null

// --- 排序 ---
const onDragStart = (id: string) => {
  draggingId.value = id
}
const onDrop = (targetId: string) => {
  if (draggingId.value && draggingId.value !== targetId) {
    store.moveTask(draggingId.value, targetId, 'before')
  }
  draggingId.value = null
}
const moveUp = (index: number) => {
  const current = taskList.value[index]
  const previous = taskList.value[index - 1]
  if (current && previous) store.moveTask(current.id, previous.id, 'before')
}
const moveDown = (index: number) => {
  const current = taskList.value[index]
  const next = taskList.value[index + 1]
  if (current && next) store.moveTask(current.id, next.id, 'after')
}
</script>

<style scoped></style>
