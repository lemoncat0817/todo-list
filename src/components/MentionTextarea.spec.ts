import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MentionTextarea from '@/components/MentionTextarea.vue'

const MEMBERS = [
  { userId: 'u1', displayName: 'Alice' },
  { userId: 'u2', displayName: 'Bob' },
]

function mountInput(modelValue = '') {
  return mount(MentionTextarea, {
    props: { modelValue, id: 'test-input', label: '測試輸入', members: MEMBERS },
  })
}

describe('MentionTextarea.vue', () => {
  it('輸入內容會 emit update:modelValue', async () => {
    const w = mountInput()
    await w.find('textarea').setValue('你好')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['你好'])
  })

  it('打 @ 後出現成員建議清單', async () => {
    const text = '@a'
    const w = mountInput(text)
    const textarea = w.find('textarea').element as HTMLTextAreaElement
    textarea.setSelectionRange(text.length, text.length)
    await w.find('textarea').trigger('input')

    expect(w.findAll('li')).toHaveLength(1)
    expect(w.text()).toContain('Alice')
  })

  it('點選建議會把 @詞元換成完整名稱，並補一個空白', async () => {
    const text = '嗨 @a'
    const w = mountInput(text)
    const textarea = w.find('textarea').element as HTMLTextAreaElement
    textarea.setSelectionRange(text.length, text.length)
    await w.find('textarea').trigger('input')

    await w.find('button').trigger('mousedown')

    expect(w.emitted('update:modelValue')?.at(-1)).toEqual(['嗨 @Alice '])
  })

  it('沒有比對到任何成員時不顯示建議清單', async () => {
    const text = '@z'
    const w = mountInput(text)
    const textarea = w.find('textarea').element as HTMLTextAreaElement
    textarea.setSelectionRange(text.length, text.length)
    await w.find('textarea').trigger('input')

    expect(w.findAll('li')).toHaveLength(0)
  })

  it('Escape 關閉建議清單', async () => {
    const text = '@a'
    const w = mountInput(text)
    const textarea = w.find('textarea').element as HTMLTextAreaElement
    textarea.setSelectionRange(text.length, text.length)
    await w.find('textarea').trigger('input')
    expect(w.findAll('li')).toHaveLength(1)

    await w.find('textarea').trigger('keydown', { key: 'Escape' })
    expect(w.findAll('li')).toHaveLength(0)
  })
})
