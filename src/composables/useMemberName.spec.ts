import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useWorkspaceStore } from '@/stores/workspace'
import { useMemberName } from './useMemberName'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useMemberName', () => {
  it('userId 為 null 時顯示「系統」（非使用者觸發的事件）', () => {
    const memberName = useMemberName()
    expect(memberName(null)).toBe('系統')
  })

  it('是目前登入的自己時顯示「我」', () => {
    useAuthStore().session = { user: { id: 'me' } } as never
    const memberName = useMemberName()
    expect(memberName('me')).toBe('我')
  })

  it('比對到 workspace.members 時顯示 display_name', () => {
    useAuthStore().session = { user: { id: 'me' } } as never
    useWorkspaceStore().members = [
      { user_id: 'bob', role: 'member', joined_at: '2030-01-01', profiles: { display_name: 'Bob', avatar_url: null } },
    ]
    const memberName = useMemberName()
    expect(memberName('bob')).toBe('Bob')
  })

  it('成員沒有 profile 或 display_name 是空字串時顯示「（未命名）」', () => {
    useWorkspaceStore().members = [
      { user_id: 'bob', role: 'member', joined_at: '2030-01-01', profiles: { display_name: '', avatar_url: null } },
    ]
    const memberName = useMemberName()
    expect(memberName('bob')).toBe('（未命名）')
  })

  it('workspace.members 裡找不到時顯示「已離開的成員」', () => {
    const memberName = useMemberName()
    expect(memberName('gone')).toBe('已離開的成員')
  })
})
