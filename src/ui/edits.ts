import type { LoadedScene, SourceEntry, Vec3 } from '../scene/types'
import { validateEdits } from '../schema/validate'

export interface EditDocument {
  formatVersion: 1
  scene: string
  edits: Edit[]
}

export type Edit =
  | { id: string; kind: 'replace'; region: [Vec3, Vec3]; block: string }
  | { id: string; kind: 'delete'; at: Vec3 }
  | { id: string; kind: 'param'; element: string; param: string; value: unknown }
  | { id: string; kind: 'note'; element: string; text: string }
export type EditInput = Edit extends infer E ? E extends { id: string } ? Omit<E, 'id'> : never : never

export function createEdits(scene: LoadedScene): EditDocument {
  return { formatVersion: 1, scene: scene.sha256, edits: [] }
}

export function selectPoint(points: Vec3[], point: Vec3): Vec3[] {
  return points.length < 2 ? [...points, point] : [point]
}

export function selectionRegion(points: Vec3[]): [Vec3, Vec3] | undefined {
  if (points.length !== 2) return undefined
  return [points[0].map((v, i) => Math.min(v, points[1][i])) as Vec3,
    points[0].map((v, i) => Math.max(v, points[1][i])) as Vec3]
}

export function addEdit(document: EditDocument, edit: EditInput): EditDocument {
  return addEdits(document, [edit])
}

export function addEdits(document: EditDocument, additions: EditInput[]): EditDocument {
  const ids = new Set(document.edits.map(edit => edit.id))
  let serial = 1
  const edits = additions.map(edit => {
    while (ids.has(`e${serial}`)) serial++
    const id = `e${serial++}`
    ids.add(id)
    return { ...edit, id } as Edit
  })
  return { ...document, edits: [...document.edits, ...edits] }
}

export function undoEdit(document: EditDocument, index: number): EditDocument {
  return { ...document, edits: document.edits.filter((_, i) => i !== index) }
}

export { validateEdits }

export function sourceAt(sources: SourceEntry[], id: number): SourceEntry | undefined {
  return sources.find(source => source.id === id)
}
