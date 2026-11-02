import { loadScene } from './load'

/** URL フラグメントの token を API の Bearer 認証へ渡す。開発時は dev サーバーの固定トークンを使う。 */
export function apiHeaders(): HeadersInit {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? (import.meta.env.DEV ? 'development' : '')
  return { Authorization: `Bearer ${token}` }
}

export async function fetchScene() {
  const response = await fetch('/api/scene', { headers: apiHeaders() })
  if (!response.ok) throw new Error(`scene の取得に失敗しました (${response.status})`)
  return loadScene(new Uint8Array(await response.arrayBuffer()))
}

/** path は assets/minecraft/... のキャッシュ内相対パス。JSON と画像を同じ認証で取得する。 */
export async function fetchAsset(version: string, path: string): Promise<Response> {
  const url = `/api/assets/${encodeURIComponent(version)}/${path.split('/').map(encodeURIComponent).join('/')}`
  const response = await fetch(url, { headers: apiHeaders() })
  if (!response.ok) throw new Error(`アセットの取得に失敗しました (${response.status}): ${path}`)
  return response
}
