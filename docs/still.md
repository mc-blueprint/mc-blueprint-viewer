# ヘッドレス静止画の接続契約（Issue #7）

`/?still=iso&preset=vanilla#token=<起動時トークン>` で静止画モードを起動する。API・sceneの形式と認証は通常表示と共通。トークンはクエリでなくフラグメントに置く。

| 指定 | 値・動作 |
|---|---|
| still | `iso` / `front` / `top`。省略すると通常表示。不正値・空値は起動失敗 |
| preset | `vanilla`（既定）/ `soft` / `cinematic`。静止画モードでのみ解釈 |
| iso | sceneの中心から東・上・北方向（1 : 0.8 : -1） |
| front | 北側（-Z）から中心を見る。+Yが画面上 |
| top | 上空（+Y）から中心を見る。北（-Z）が画面上 |

透視投影・FOV 50度。sceneのsize全体の外接球が出力の縦横両方の画角に収まる距離へ配置する。余白の空気もsizeに含む。画像寸法はブラウザのviewport、倍率はdeviceScaleFactorで決める。UIを非表示にしてcanvasをviewport全体へ広げ、ユーザー操作を無効にする。静止画ではauto品質の時間経過による引下げを止め、sceneの品質上限と指定プリセットを使う。

## Fのrenderが待つ通知

`window.viewer.ready === true`（同じ状態を `#status[data-ready="true"]` にも表示）を待つ。アセット・光のWorker計算・通常メッシュ・特殊描画・固定視点・プリセットの適用と、後処理を含む描画、GPUの`finish()`が完了してから観測できる永続フラグ。イベント購読のタイミングに依存しない。更新中はfalseへ戻る。

起動・アセット取得・モデル構築に失敗した場合は `[role="alert"]` に原因を表示し、readyにはしない。呼出し元はreadyとalertを同時に監視し、設定の `render.timeout_seconds` を待機の上限にする。WebGL2が使えない場合のブラウザ起動方式・終了コード2への変換・ブラウザ本体のsetupはF側の責務。

```javascript
// viewport / deviceScaleFactorはページ作成時に設定する。
await page.goto(urlWithStillAndToken)
await page.waitForFunction(() => window.viewer?.ready || document.querySelector('[role="alert"]'),
  undefined, { timeout: timeoutSeconds * 1000 })
const error = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent)
if (error) throw new Error(error)
await page.locator('#viewport canvas').screenshot({ path: outputFile })
```

静止画モードではアセットやメッシュの構築途中の画像をreadyとしない。カメラやプリセットを同一ページで変更する場合は、既存の `setPreset()` / `renderFrame()` のPromiseを待つ（[mesh.md](mesh.md)）。初期URLの固定視点を変える場合は別URLへ遷移する。

## 開発用の撮影基盤

Playwright 1.56.1（開発依存、Apache-2.0）の `chromium.launchPersistentContext()` で別プロファイルのヘッドレスEdgeを起動する。`scripts/browser.mjs` の `withBrowser` / `waitReady` / `captureCanvas` を使い、既存の性能測定でも同じ基盤を共有する。`captureCanvas` は `renderFrame()` 後のcanvas範囲だけを撮る。既存スクリプト向けのCDP `send` / `evaluate` も維持し、`Page.navigate` はDOM読み込みを待つ。

既定の実行ファイルはWindowsのEdge。別のChromiumは `VIEWER_BROWSER` に絶対パスを指定する。ブラウザ本体のダウンロード・同梱は行わない。生成画像・展開アセット・jarをGitへ追加しない。[全4版の再現手順と目視結果](visual-check.md)を参照。

CDP互換の `Page.captureScreenshot` も内部ではPlaywrightのscreenshotへ渡し、GPUのfinishとは別にブラウザの合成フレームを待つ。生CDP撮影では合成前の背景だけを取得することがあったため、この経路を共通で使う。
