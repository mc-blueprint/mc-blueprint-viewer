# 通常メッシュの接続契約（Issue #2）

`loadModels(palette, version)` は `render: model` だけの blockstate・親モデルを認証付きで取得し、palette 添字ごとの形状取得関数を返す。fluid / entity / invisible の関数は undefined。取得失敗は例外を起動画面へ返し、準備完了にはしない。通常メッシュに特殊描画の代替箱は入れない（#4 が担当）。

`createAtlas` は PNG の先頭フレームをアトラスにまとめる。完全不透明・二値アルファ（葉・ガラス板など）・中間アルファでマテリアルを分け、二値は alphaTest、中間アルファは透明描画・depthWrite 無効とする。透明の並べ替えは three.js のチャンク内レイヤー単位で、面同士の完全な透過順序は保証しない。アニメーションはこのIssueの対象外。

## #3: 光の値とマテリアル

`buildChunk` の BufferGeometry はインデックス付き（1面4頂点・2三角形）。`position` と `blockPosition` は scene ローカル座標、`normal` は面の法線、`uv` はアトラス内の座標、`color` は tint 適用済みの線形 RGB。

`light` は Float32 の3成分で `[sky, block, ao]`（それぞれ 0〜15、0〜15、0〜1）。初期値は `[15, 0, 1]`。#3 の `lightVertices` が頂点の属性を書き換え `needsUpdate = true` とし、`lightMaterial` がライトマップ・面の向き・AO・太陽の影を合成する。tint 適用済みの `color` は保持する。位置・法線・所有ブロックを使って面の外側をサンプリングする。部分モデルは所有ブロックの外側、斜面は主法線軸による近似。カメラ移動・断面変更で作り直した geometry にも `MeshWorld` の第5引数の `apply(geometry, slice)` が適用される。マテリアルは同引数の `material(layer)` で渡す。省略時は従来の MeshBasicMaterial。

`MeshWorld.group` 配下の各チャンク Group がレイヤーごとの three.js Mesh を持つ。不透明・二値アルファの Mesh は影を落とし、全レイヤーが影を受ける。#3 の接続箇所は `src/mesh/world.ts` の第5引数と `src/main.ts` の起動処理。#4 の特殊描画も `loadLight` の結果と `lightMaterial` を再利用できる。`lightVertices` には position / normal / blockPosition / light が必要。

`loadLight(loaded)` は Web Worker で scene 全体を一度計算し、`LightVolume { size, sky, block, opacity }` を返す。各 Uint8Array は `(y * size[2] + z) * size[0] + x` 順、元のブロック配列は転送・変更しない。エラーは起動画面へ返し、光の完了前に ready にしない。上空だけを空の光の流入元とし、直射の15は透明な空気で減衰しない。それ以外は入射先の `max(1, opacity)` で減衰する。ブロック光は不透明な発光体からも伝播する。頂点サンプルは水平の範囲外を端へ固定し、上空はsky=15・block=0、下端は0。断面は元の建物の光を保ち、AOだけ非表示ブロックを除く。

scene 全体の照明は常駐メッシュと独立し、保持量は3 bytes/voxel（256×128×256で24MiB）。Worker は計算中に追加で待ち行列とフラグの5 bytes/voxel、および入力のブロック配列のコピーを使う。時刻・明るさ・blockLightはライトマップに反映し、low / auto の影は無効、medium=2048・high=4096。ゲームの光レベルの非線形減衰と明るさの四次補間を使用するが、色味・環境光・斜面AOは近似で、ゲーム画面との同一性は保証しない。

## #4: 特殊描画と断面

特殊描画は同じ LoadedScene を読む別 Group とする。`Slice { minY, maxY }` は表示するブロックの Y 範囲（両端を含む）。上限だけなら minY=0、単一階なら minY=maxY。`MeshWorld.update(camera.position, slice)` の呼出しと同じ範囲を特殊描画へ渡す。断面外の隣接ブロックは面省略に使わず、切断面を復元する。

## #6: レイとブロック座標

`Raycaster.intersectObject(meshes.group, true)` の命中を `blockFromIntersection(hit)` に渡すと、三角形を所有するブロックの整数 `[x,y,z]` が得られる。階段・柵の細い面、チャンク境界でも丸め誤差を避けられる。透明 PNG の穴自体の命中判定は行わない。

`BlockAccess.block(x,y,z)` は整数の scene ローカル座標を受け、palette 添字を返す。範囲外・省略チャンクは0（空気）。`origin` を足すのは元データ座標へ戻すときだけ。sources の取得は同じ座標から対象 DecodedChunk の実寸で添字を計算する（README 参照）。

## 常駐制御・検証

MeshWorld はカメラからチャンク中心までの距離順に作る。quality の面上限は low=200万、medium=500万、high=1,000万、auto は low。上限で距離順の連続した集合を打ち切り、遠方の geometry を dispose して CPU/GPU の参照も外す。構築途中も残りの面予算を超えたチャンクを保持しない。既存チャンクは再利用し、構築中は時間を区切ってイベントループへ戻る。より新しい視点・断面の更新が来たら古い更新を打ち切る。

上限は四角形の面数であり、バイト数・FPSの保証ではない。`stats.meshBytes` は頂点・インデックス配列の合計（1面296 bytes）で、GPUへの複製・構築中の一時配列・scene の配列・JSオブジェクトを含まない。`atlasBytes` は RGBA のサイズ。fps・プロセスメモリは別に測る。

実行状態は `window.viewer.ready` または `#status[data-ready=true]` で確認できる。`window.viewer.metrics` は常駐面数・配列バイト数・フレーム数などの計測用。scene・camera・controls・renderer・meshes もここから検査できる。これは現時点の開発接続点で、#5 の静止画プロトコルは未実装。
