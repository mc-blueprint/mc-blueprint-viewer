import { Raycaster, Vector2 } from 'three'
import { apiHeaders } from '../scene/api'
import type { LoadedScene, Vec3 } from '../scene/types'
import { BlockAccess, blockFromIntersection } from '../mesh/chunk'
import type { MeshWorld } from '../mesh/world'
import { addEdit, createEdits, selectPoint, selectionRegion, sourceAt, undoEdit, validateEdits } from './edits'
import type { Edit, EditDocument, EditInput } from './edits'

export function mountSelectionUI(loaded: LoadedScene, meshes: MeshWorld, camera: import('three').Camera, canvas: HTMLCanvasElement) {
  const access = new BlockAccess(loaded)
  let edits = createEdits(loaded)
  let selected: Vec3[] = []
  let blockAt: Vec3 | undefined
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  const panel = document.createElement('section')
  panel.id = 'selection-panel'
  panel.innerHTML = '<h2>ブロック選択</h2><p id="block-info">ブロックをクリックしてください。</p><button id="pick">範囲の始点を選ぶ</button><p id="range-info"></p><label>操作 <select id="kind"><option value="replace">置換</option><option value="delete">削除</option><option value="note">自由文</option><option value="param">パラメータ</option></select></label><label id="param-name-label" hidden>パラメータ <select id="param-name"></select></label><label id="value-label">ブロックID <input id="value" value="minecraft:stone"></label><button id="add" disabled>edits に追加</button><h3>修正指示</h3><ol id="edit-list"></ol><button id="save">保存</button> <button id="regenerate">再生成</button><p id="edit-status" role="status"></p>'
  const blocksOnly = new URLSearchParams(location.search).get('editMode') === 'blocks'
  const kind = panel.querySelector<HTMLSelectElement>('#kind')!
  if (blocksOnly) {
    kind.querySelector<HTMLOptionElement>('[value="note"]')!.hidden = true
    kind.querySelector<HTMLOptionElement>('[value="param"]')!.hidden = true
  }
  document.querySelector('main')!.append(panel)
  const info = panel.querySelector<HTMLElement>('#block-info')!
  const pick = panel.querySelector<HTMLButtonElement>('#pick')!
  const rangeInfo = panel.querySelector<HTMLElement>('#range-info')!
  const value = panel.querySelector<HTMLInputElement>('#value')!
  const valueLabel = panel.querySelector<HTMLLabelElement>('#value-label')!
  const paramNameLabel = panel.querySelector<HTMLLabelElement>('#param-name-label')!
  const paramName = panel.querySelector<HTMLSelectElement>('#param-name')!
  const add = panel.querySelector<HTMLButtonElement>('#add')!
  const list = panel.querySelector<HTMLOListElement>('#edit-list')!
  const status = panel.querySelector<HTMLElement>('#edit-status')!
  let editing: number | undefined

  function updateForm() {
    const isNote = kind.value === 'note'
    const isParam = kind.value === 'param'
    valueLabel.firstChild!.textContent = isNote ? '自由文 ' : isParam ? '値 ' : 'ブロックID '
    value.placeholder = isNote ? '変更内容' : isParam ? '例: 30 または "high"' : '例: minecraft:glass'
    value.hidden = kind.value === 'delete'
    paramNameLabel.hidden = !isParam
    const region = selectionRegion(selected)
    const source = sourceAt(loaded.document.sources, sourceId(blockAt))
    const unsupportedSource = loaded.document.source.kind !== 'spec'
    const oldParam = paramName.value
    paramName.replaceChildren(...(source?.params ?? []).map(name => new Option(name, name)))
    if ([...paramName.options].some(option => option.value === oldParam)) paramName.value = oldParam
    kind.querySelector('[value="note"]')!.toggleAttribute('disabled', blocksOnly || unsupportedSource || !source?.element)
    kind.querySelector('[value="param"]')!.toggleAttribute('disabled', blocksOnly || unsupportedSource || !source?.element || !source.params?.length)
    if ((kind.value === 'note' || kind.value === 'param') && unsupportedSource) kind.value = 'replace'
    add.disabled = !region || ((kind.value === 'note' || kind.value === 'param') && (!source?.element || unsupportedSource))
  }

  function renderEdits() {
    list.replaceChildren()
    edits.edits.forEach((edit, index) => {
      const row = document.createElement('li')
      const summary = document.createElement('span')
      summary.textContent = JSON.stringify(edit)
      const editButton = document.createElement('button')
      editButton.textContent = '編集'
      editButton.addEventListener('click', () => {
        editing = index
        kind.value = edit.kind
        if (edit.kind === 'replace') value.value = edit.block
        else if (edit.kind === 'note') value.value = edit.text
        else if (edit.kind === 'param') { value.value = JSON.stringify(edit.value); paramName.value = edit.param }
        updateForm()
        status.textContent = `e${index + 1} の編集内容を入力してください。範囲選択後に追加を押すと置き換えます。`
      })
      const remove = document.createElement('button')
      remove.textContent = '取り消し'
      remove.addEventListener('click', () => { edits = undoEdit(edits, index); editing = undefined; renderEdits() })
      row.append(summary, editButton, remove)
      list.append(row)
    })
  }

  function sourceId(at: Vec3 | undefined) {
    if (!at) return 0
    const chunk = loaded.chunks.find(c => at.every((v, i) => v >= c.at[i] && v < c.at[i] + c.size[i]))
    return chunk ? chunk.sources[((at[1] - chunk.at[1]) * chunk.size[2] + at[2] - chunk.at[2]) * chunk.size[0] + at[0] - chunk.at[0]] : 0
  }

  function describe(at: Vec3) {
    const palette = loaded.document.palette[access.block(...at)]
    const source = sourceAt(loaded.document.sources, sourceId(at))
    info.textContent = `${at.join(', ')} / ${palette.state} / render: ${palette.render}${source ? ` / 生成元: ${[source.label, source.element, source.spec, source.path].filter(Boolean).join(' / ')}` : ' / 生成元: 不明'}`
    if (source?.params?.length) info.textContent += ` / params: ${source.params.join(', ')}`
    updateForm()
  }

  function pointFromPointer(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect()
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera)
    const hit = raycaster.intersectObject(meshes.group, true).find(item => item.face && blockFromIntersection(item))
    return hit ? blockFromIntersection(hit) : undefined
  }

  let down: [number, number] | undefined
  canvas.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY] })
  canvas.addEventListener('pointerup', event => {
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 4) return
    const at = pointFromPointer(event)
    if (!at) return
    blockAt = at
    describe(at)
    if (pick.dataset.active === 'true') {
      selected = selectPoint(selected, at)
      rangeInfo.textContent = selected.length === 2 ? `範囲: ${JSON.stringify(selectionRegion(selected))}` : `始点: ${at.join(', ')}。終点を選択してください。`
      pick.textContent = selected.length === 2 ? '範囲を選び直す' : '範囲の終点を選ぶ'
      updateForm()
    }
  })
  pick.addEventListener('click', () => {
    selected = []
    pick.dataset.active = 'true'
    pick.textContent = '始点を選択してください'
    rangeInfo.textContent = '3D画面上で範囲の2点を選択してください。'
    updateForm()
  })
  kind.addEventListener('change', updateForm)
  add.addEventListener('click', () => {
    const region = selectionRegion(selected)
    const source = sourceAt(loaded.document.sources, sourceId(blockAt))
    if (!region) return
    let edit: EditInput
    if (kind.value === 'replace') edit = { kind: 'replace', region, block: value.value.trim() }
    else if (kind.value === 'delete') edit = { kind: 'delete', region }
    else if (kind.value === 'note') {
      if (!source?.element) { status.textContent = '生成元 element がないため自由文を追加できません。'; return }
      edit = { kind: 'note', element: source.element, text: value.value.trim() }
    } else {
      const param = paramName.value
      if (!source?.element || !param) { status.textContent = '変更できるパラメータがありません。'; return }
      let paramValue: unknown
      try { paramValue = JSON.parse(value.value) } catch { paramValue = value.value }
      edit = { kind: 'param', element: source.element, param, value: paramValue }
    }
    edits = editing === undefined ? addEdit(edits, edit) : replaceEdit(edits, editing, edit)
    editing = undefined
    selected = []
    pick.dataset.active = 'false'
    pick.textContent = '範囲の始点を選ぶ'
    rangeInfo.textContent = ''
    status.textContent = ''
    renderEdits()
    updateForm()
  })

  async function post(path: string, body?: EditDocument) {
    const response = await fetch(path, { method: 'POST', headers: { ...apiHeaders(), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await response.text()
    let result: { code?: number; diagnostics?: unknown; message?: unknown; error?: unknown } = {}
    if (text) {
      try { result = JSON.parse(text) as typeof result }
      catch { if (!response.ok) throw new Error(text) }
    }
    if (!response.ok) throw new Error(text ? errorMessage(text, result, response.status) : `${path} に失敗しました (${response.status})`)
    return result
  }
  const save = panel.querySelector<HTMLButtonElement>('#save')!
  const regenerate = panel.querySelector<HTMLButtonElement>('#regenerate')!
  let busy = false
  async function run(action: () => Promise<void>) {
    if (busy) return
    busy = true
    save.disabled = regenerate.disabled = true
    panel.inert = true
    try { await action() }
    catch (error) { status.textContent = error instanceof Error ? error.message : String(error) }
    finally { busy = false; save.disabled = regenerate.disabled = false; panel.inert = false }
  }
  save.addEventListener('click', () => {
    if (!validateEdits(edits)) { status.textContent = 'edits v1 の形式が不正です。'; return }
    void run(async () => { await post('/api/edits', edits); status.textContent = 'edits を保存しました。' })
  })
  regenerate.addEventListener('click', () => {
    if (!validateEdits(edits)) { status.textContent = 'edits v1 の形式が不正です。'; return }
    void run(async () => {
      await post('/api/edits', edits)
      const result = await post('/api/regenerate')
      status.textContent = result.code === 3
        ? `再生成は完了しましたが、評価に合格しませんでした (code=3)。${result.diagnostics === undefined ? '' : ` ${JSON.stringify(result.diagnostics)}`}`
        : '再生成が完了しました。'
    })
  })
  renderEdits()
  updateForm()

  let stopped = false
  void (async () => {
    while (!stopped) {
      try {
        const response = await fetch('/api/events', { headers: apiHeaders() })
        if (!response.ok || !response.body) throw new Error('events 接続に失敗しました')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!stopped) {
          const { value: bytes, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(bytes, { stream: true })
          const chunks = buffer.split(/\r?\n\r?\n/)
          buffer = chunks.pop() ?? ''
          if (chunks.some(chunk => chunk.includes('event: scene-updated'))) location.reload()
        }
      } catch { await new Promise(resolve => setTimeout(resolve, 1000)) }
    }
  })()
  return () => { stopped = true; panel.remove() }
}

function errorMessage(text: string, body: { message?: unknown; error?: unknown }, status: number) {
  if (typeof body.message === 'string') return `${status}: ${body.message}`
  if (typeof body.error === 'string') return `${status}: ${body.error}`
  try { return `${status}: ${JSON.stringify(JSON.parse(text))}` }
  catch { return `${status}: ${text}` }
}

function replaceEdit(document: EditDocument, index: number, edit: EditInput): EditDocument {
  const existing = document.edits[index]
  return { ...document, edits: document.edits.map((item, i) => i === index ? { ...edit, id: existing.id } as Edit : item) }
}
