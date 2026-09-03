import { describe, it, expect } from 'vitest'
import { pickCurrentWorkspaceId } from './pickWorkspace'

const mine = { id: 'mine', is_personal: true, created_by: 'u-b' }
const theirs = { id: 'theirs', is_personal: true, created_by: 'u-a' }
const shared = { id: 'shared', is_personal: false, created_by: 'u-a' }

describe('pickCurrentWorkspaceId', () => {
  it('有記住的工作區且還在清單裡時優先用它', () => {
    expect(
      pickCurrentWorkspaceId([theirs, mine], { userId: 'u-b', rememberedId: 'mine' }),
    ).toBe('mine')
    expect(
      pickCurrentWorkspaceId([theirs, mine], { userId: 'u-b', rememberedId: 'theirs' }),
    ).toBe('theirs')
  })

  it('記住的 id 已不在清單（被踢出）時改選自己的個人工作區', () => {
    expect(
      pickCurrentWorkspaceId([theirs, mine], { userId: 'u-b', rememberedId: 'gone' }),
    ).toBe('mine')
  })

  it('沒有記住時選自己建立的個人工作區，即使別人的個人工作區排在前面', () => {
    expect(
      pickCurrentWorkspaceId([theirs, mine, shared], { userId: 'u-b', rememberedId: null }),
    ).toBe('mine')
  })

  it('清單為空時回傳 null', () => {
    expect(pickCurrentWorkspaceId([], { userId: 'u-b', rememberedId: null })).toBeNull()
  })
})
