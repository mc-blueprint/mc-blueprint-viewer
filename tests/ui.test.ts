import { expect, it } from 'vitest'
import { addEdit, addEdits, createEdits, selectPoint, selectionRegion, undoEdit, validateEdits } from '../src/ui/edits'
import type { LoadedScene } from '../src/scene/types'

const sha256 = 'a'.repeat(64)
const loaded = { sha256 } as LoadedScene

it('2点の選択を正規化し、edits v1へ追加して取り消せる', () => {
  const points = selectPoint(selectPoint([], [4, 3, 8]), [1, 6, 2])
  expect(selectionRegion(points)).toEqual([[1, 3, 2], [4, 6, 8]])
  const created = addEdit(createEdits(loaded), { kind: 'replace', region: selectionRegion(points)!, block: 'minecraft:glass' })
  expect(created).toEqual({ formatVersion: 1, scene: sha256, edits: [{ id: 'e1', kind: 'replace', region: [[1, 3, 2], [4, 6, 8]], block: 'minecraft:glass' }] })
  expect(validateEdits(created)).toBe(true)
  expect(undoEdit(created, 0).edits).toEqual([])
  const afterUndo = addEdit(undoEdit(created, 0), { kind: 'delete', at: [0, 0, 0] })
  expect(afterUndo.edits[0].id).toBe('e1')
})

it('UIが作るreplace・delete・param・noteを正本edits v1スキーマで検証できる', () => {
  const edits = addEdits(createEdits(loaded), [
    { kind: 'replace', region: [[1, 2, 3], [4, 5, 6]], block: 'minecraft:glass_pane' },
    { kind: 'delete', at: [1, 2, 3] },
    { kind: 'param', element: 'tower#3', param: 'height', value: 30 },
    { kind: 'note', element: 'tower#3', text: '屋根を高くする' },
  ])
  expect(edits.edits.map(edit => edit.id)).toEqual(['e1', 'e2', 'e3', 'e4'])
  expect(validateEdits(edits)).toBe(true)
})

it('32³の削除を1件のregionで保存し、1MiB以内に収める', () => {
  const edits = addEdit(createEdits(loaded), { kind: 'delete', region: [[0, 0, 0], [31, 31, 31]] })
  expect(validateEdits(edits)).toBe(true)
  expect(edits.edits).toEqual([{ id: 'e1', kind: 'delete', region: [[0, 0, 0], [31, 31, 31]] }])
  expect(new TextEncoder().encode(JSON.stringify(edits)).byteLength).toBeLessThan(1024 * 1024)
})

it('deleteのatとregionの両指定・指定なしを共通スキーマで拒否する', () => {
  const document = createEdits(loaded)
  expect(validateEdits({ ...document, edits: [{ id: 'e1', kind: 'delete', at: [0, 0, 0], region: [[0, 0, 0], [1, 1, 1]] }] })).toBe(false)
  expect(validateEdits({ ...document, edits: [{ id: 'e1', kind: 'delete' }] })).toBe(false)
})
