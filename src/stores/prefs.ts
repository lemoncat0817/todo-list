import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { StateTree } from 'pinia'
import { createPersistOptions } from '@/infra/persist'
import { GROUP_LABELS, SORT_LABELS, type GroupKey, type SortKey } from '@/domain/views'

/**
 * 會被記住的顯示偏好。
 *
 * 與 stores/ui 分開，而不是在同一個 store 裡挑欄位持久化：持久化 plugin
 * 寫的是整份 state，兩者混在一起就會連「搜尋開著沒」也一併存起來——
 * 那正是先前讓使用者重新整理後卡在搜尋畫面的原因。
 *
 * 判準很簡單：下次打開還想維持的，放這裡；這一次操作結束就該忘掉的，放 ui。
 */
export const usePrefsStore = defineStore(
  'prefs',
  () => {
    const sortBy = ref<SortKey>('manual')
    const groupBy = ref<GroupKey>('none')

    function setSort(value: SortKey): void {
      sortBy.value = value
    }

    function setGroupBy(value: GroupKey): void {
      groupBy.value = value
    }

    return { sortBy, groupBy, setSort, setGroupBy }
  },
  {
    /**
     * 跨信任邊界的資料一律先正規化：localStorage 是使用者（或別的分頁、
     * 或舊版的自己）可以寫進任意內容的地方。壞值一律退回預設，
     * 而不是讓一個不存在的排序鍵讓清單整區消失。
     */
    persist: createPersistOptions('todoTask:prefs', (raw): StateTree => {
      const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
      const sortBy =
        typeof record.sortBy === 'string' && record.sortBy in SORT_LABELS
          ? (record.sortBy as SortKey)
          : 'manual'
      const groupBy =
        typeof record.groupBy === 'string' && record.groupBy in GROUP_LABELS
          ? (record.groupBy as GroupKey)
          : 'none'
      return { sortBy, groupBy }
    }),
  },
)
