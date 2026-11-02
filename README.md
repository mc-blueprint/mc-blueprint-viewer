# mc-blueprint-viewer

[mc-blueprint](https://github.com/mc-blueprint/mc-blueprint) の生成結果を 3D で表示するブラウザアプリ。TypeScript、three.js、deepslate で作り、ビルド済みのファイルを mc-blueprint に同梱する。

## 範囲

| 担当する | 担当しない |
|---|---|
| scene の読み込みと 3D 表示（ブロックモデル、チャンク分割、特殊描画） | 生成・検証のロジック（mc-blueprint） |
| 光（空の光・ブロック光）、影、明るさ、時刻、同梱シェーダープリセット（vanilla / soft / cinematic） | 外部シェーダーパック（OptiFine・Iris）の互換 |
| ブロック・範囲の選択、生成元の表示、修正指示（edits）の作成 | edits の解釈と適用、jar の取得（mc-blueprint） |
| ヘッドレス実行時の静止画モード | ブロック属性の独自の表（scene の描画属性を使う） |

## 状態

scene 読み込み・開発用 API と、通常ブロックのチャンクメッシュ・テクスチャ・カメラ操作・断面・階表示、Worker による空の光・ブロック光、スムースライティング・AO・太陽の影・明るさ・時刻を実装済み。左ドラッグで回転、右ドラッグで移動、ホイールで拡大する。断面上限と階は scene ローカルの Y（0始まり・両端を含む）で指定する。特殊描画は #4、選択・edits は #6 で追加する。

Minecraft の jar・テクスチャ・モデルはこのリポジトリと配布物に含めない。テクスチャは利用者の端末で mc-blueprint が展開したものを読む。

## 開発

Node 24.x / npm 11.x を使う。依存は版を固定している（選定・ライセンスは [docs/decisions.md](docs/decisions.md)）。

```powershell
npm ci
npm run fixtures
npm run assets -- 1.21.11
npm run dev
```

表示された `http://127.0.0.1:<port>/` を開く。開発時の API 認証は `Bearer development`。本番では起動 URL の `#token=<token>` から読み取る。ビルド済み viewer 自体はサーバーを起動しない。

`npm run assets -- <版> [ローカルclient.jarの絶対パス]` は、1.21.11 では既存の `%APPDATA%\.minecraft\versions\1.21.11\1.21.11.jar` を読む。他版でパスを省略すると公式 version manifest から client jar を取得し、公式の SHA-1 と照合して `%LOCALAPPDATA%\mc-blueprint\cache\jars\` に保存する。ローカルjarでは SHA-1 を計算して記録する。アセットは `cache\assets\<版>\assets\minecraft\...`、出所・SHA-1・展開日時は同階層の manifest.json。既存manifestとSHA-1が異なる場合は上書きしない。途中失敗した `<版>.tmp-<pid>` は保全されるため、確認してから手動で整理する。

`npm run fixtures -- <版>`（既定 1.21.11）は `.dev-scenes/` に representative / castle / town / terrain / underground / vegetation の gzip scene を作る。Mojang の資産は含まない。representative は階段・柵・ガラス板・上下ドア・葉・水・横向きログ・multipart・重み付き chorus plant・チェスト・頭足のあるベッド・光源を含む。残り5場面は 256×128×256。測定条件は [docs/performance.md](docs/performance.md)。

```powershell
$env:VIEWER_SCENE = '.dev-scenes/castle.scene.json.gz'
npm run dev
```

開発 API は `/api/scene` から選択した gzip、`/api/assets/<版>/assets/minecraft/<path>` からキャッシュ内の JSON / PNG を返す。gzip 本体には Content-Encoding を付けない。本番サーバーが HTTP の Content-Encoding で展開した JSON もローダーは受け付ける。POST・SSE はこの開発模擬の対象外。

## 後続Issueの境界

| 場所 | 責務・担当 |
|---|---|
| src/scene/ | #1。SceneDocument / LoadedScene / DecodedChunk、loadScene、fetchScene / fetchAsset を公開 |
| src/mesh/ | #2。モデル解決・アトラス・チャンクメッシュと常駐管理。[接続契約](docs/mesh.md)、重み付き選択・uvlock の補完は decisions.md を参照 |
| src/light/ | #3。光計算・Worker・頂点光・マテリアル・太陽。palette の emission / opacity と復号済み配列を読む |
| src/special/ | #4 で追加。fluid / entity と blockEntities の描画 |
| src/ui/ | #6 で追加。選択・生成元・edits。LoadedScene.sha256 を edits.scene に使う |
| scripts/、schema/、tests/scene.test.ts | #1 の開発基盤。後続は自分の領域にテストを追加する |
| src/main.ts / src/style.css | 起動・画面の接続点。複数担当で同時編集せずメインが統合担当を決める |

上記の後続ディレクトリは各Issueで作る。DecodedChunk.size は端を切り詰めた実寸で、配列は `(y * size[2] + z) * size[0] + x`。省略チャンクは空気、sources の0は不明。座標は scene ローカル、origin は元データでの最小コーナー。生成元の表示には document.sources を参照する。

`fetchAsset(version, path)` は Bearer 認証付き Response を返す。JSON は response.json()、画像は response.blob() と createImageBitmap() を使う（img.src の直指定では認証ヘッダーが付かない）。失敗時は例外となるため呼出し側で表示する。

## 検証・配布

```powershell
npm run lint
npm test
npm run build
npm run benchmark:scene
npm run benchmark:mesh
npm run smoke
node scripts/verify-light.mjs
```

smoke は別プロファイルのヘッドレス Edge でメッシュ準備完了を確認する。benchmark:mesh は5場面を各3回測定し、代表場面の撮影と断面・階表示も検査する（`-- --representative` で代表場面だけ、`-- --scene=castle` などで1場面だけ）。verify-light は1.21.11の代表場面で昼夜・ブロック光の有無・明るさ・品質ごとの影を撮影・画素比較し、再構築したメッシュの光属性も検査する。画像と生データは OS の一時ディレクトリへ保存し、リポジトリに含めない。既存ブラウザの画面には触れない。別の Chromium を使う場合は VIEWER_BROWSER に実行ファイルの絶対パスを設定する。

dist/ の静的ファイルと THIRD_PARTY_LICENSES.txt を mc-blueprint のサーバーから配信する。schema の出所は [schema/README.md](schema/README.md)。アセット展開スクリプト・開発 API・固定 scene・node_modules は配布しない。CI ワークフローは追加していない。

本プロジェクトは非公式で、Mojang Studios・Microsoft とは関係ありません。
