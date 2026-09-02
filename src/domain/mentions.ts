import { normalizeForSearch } from './filtering'

/**
 * @提及的解析。跟 domain/quickAdd.ts 的 #project／@tag 是同一種簡化：
 * 只吃「@ 後面一段不含空白的字元」這種單一詞元語法，不支援含空白的
 * 顯示名稱——這個工具面向的是個人／小團隊協作，這個限制目前沒有真的
 * 造成困擾，UI 端用自動完成直接插入完整名稱可以完全避開這個問題
 * （見 TaskComments.vue），需要更複雜的比對再加。
 *
 * 這裡只負責「文字裡提到了誰」這個結果，不負責通知——通知是 M4 的範圍。
 */

export interface MentionableMember {
  userId: string
  displayName: string
}

const MENTION_RE = /@(\S+)/g

/** 解析留言內容裡的 @提及，比對目前工作區的成員名單，回傳提到的 user id（去重）。 */
export function parseMentions(body: string, members: readonly MentionableMember[]): string[] {
  const found = new Set<string>()
  for (const match of body.matchAll(MENTION_RE)) {
    const token = match[1]
    if (!token) continue
    const needle = normalizeForSearch(token)
    const member = members.find((m) => normalizeForSearch(m.displayName) === needle)
    if (member) found.add(member.userId)
  }
  return [...found]
}

/**
 * 自動完成建議：游標所在那個 @ 詞元還沒打完時，列出名字以這段文字開頭
 * 的成員。回傳 null 代表游標不在任何 @ 詞元裡（不該顯示建議清單）。
 */
export function suggestMentions(
  body: string,
  cursor: number,
  members: readonly MentionableMember[],
): { range: { start: number; end: number }; suggestions: MentionableMember[] } | null {
  const before = body.slice(0, cursor)
  const start = before.lastIndexOf('@')
  if (start === -1) return null
  const token = before.slice(start + 1)
  // @ 跟游標之間如果有空白，代表這個 @ 已經是上一個詞元的一部分，早就結束了
  if (/\s/.test(token)) return null

  const end = start + 1 + token.length
  const needle = normalizeForSearch(token)
  const suggestions = members.filter((m) => normalizeForSearch(m.displayName).startsWith(needle))
  return { range: { start, end }, suggestions }
}

export interface MentionSegment {
  text: string
  /** 這段是不是一個真的比對到成員的 @提及——畫面只高亮這種，比對不到的 @ 當純文字顯示。 */
  member: MentionableMember | null
}

/**
 * 把留言內容切成一段段純文字／@提及，給畫面逐段渲染用（v-for 不是
 * v-html——留言內容是使用者輸入，不能當 HTML 插進去）。
 */
export function splitMentionSegments(body: string, members: readonly MentionableMember[]): MentionSegment[] {
  const segments: MentionSegment[] = []
  let lastIndex = 0
  for (const match of body.matchAll(MENTION_RE)) {
    const token = match[1]
    const index = match.index
    if (!token || index === undefined) continue
    const member = members.find((m) => normalizeForSearch(m.displayName) === normalizeForSearch(token)) ?? null
    if (!member) continue
    if (index > lastIndex) segments.push({ text: body.slice(lastIndex, index), member: null })
    segments.push({ text: `@${token}`, member })
    lastIndex = index + token.length + 1
  }
  if (lastIndex < body.length) segments.push({ text: body.slice(lastIndex), member: null })
  return segments
}
