# 通常メッシュの接続契約（Issue #2）

`loadModels(palette, version)` は `render: model` だけの blockstate・親モデルを認証付きで取得し、palette 添字ごとの形状取得関数を返す。fluid / entity / invisible の関数は undefined。取得失敗は例外を起動画面へ返し、準備完了にはしない。通常メッシュに特殊描画の代替箱は入れない（#4 が担当）。

`createAtlas` は PNG の先頭フレームをアトラスにまとめる。完全不透明・二値アルファ（葉・ガラス板など）・中間アルファでマテリアルを分け、二値は alphaTest、中間アルファは透明描画・depthWrite 無効とする。透明の並べ替えは three.js のチャンク内レイヤー単位で、面同士の完全な透過順序は保証しない。アニメーションはこのIssueの対象外。

## #3: 光の値とマテリアル

`buildChunk` の BufferGeometry はインデックス付き（1面4頂点・2三角形）。`position` と `blockPosition` は scene ローカル座標、`normal` は面の法線、`uv` はアトラス内の座標、`color` は tint 適用済みの線形 RGB。

`light` は Float32 の3成分で `[sky, block, ao]`（それぞれ 0〜15、0〜15、0〜1）。初期値は `[15, 0, 1]`。#3 は各頂点の属性を書き換え `needsUpdate = true` とし、光を使うマテリアルへ接続する。現時点の MeshBasicMaterial はこの属性を消費しない。位置・法線・所有ブロックを使って面の外側をサンプリングできる。メッシュはカメラ移動・断面変更で作り直されるため、新しい geometry にも光を設定する必要がある。

`MeshWorld.group` 配下の各チャンク Group がレイヤーごとの three.js Mesh を持つ。#3 の接続では `src/mesh/world.ts`、起動の接続では `src/main.ts` に変更が必要になる。#4・#6 と同時編集しないようメインが担当を調整する。

## #4: 特殊描画と断面

特殊描画は同じ LoadedScene を読む別 Group とする。`Slice { minY, maxY }` は表示するブロックの Y 範囲（両端を含む）。上限だけなら minY=0、単一階なら minY=maxY。`MeshWorld.update(camera.position, slice)` の呼出しと同じ範囲を特殊描画へ渡す。断面外の隣接ブロックは面省略に使わず、切断面を復元する。

流体の水源は上に同じ流体がなければ高さ 8/9、上に続く場合は 1 とし、level 1〜7 は `(8 - level) / 8` で近似する。四隅の高さの平均や流向による傾斜は計算しない。チェストの通常・trapped は単体／左右で各専用テクスチャを選び、ender chest は単体テクスチャを使う。

## #6: レイとブロック座標

`Raycaster.intersectObject(meshes.group, true)` の命中を `blockFromIntersection(hit)` に渡すと、三角形を所有するブロックの整数 `[x,y,z]` が得られる。階段・柵の細い面、チャンク境界でも丸め誤差を避けられる。透明 PNG の穴自体の命中判定は行わない。

`BlockAccess.block(x,y,z)` は整数の scene ローカル座標を受け、palette 添字を返す。範囲外・省略チャンクは0（空気）。`origin` を足すのは元データ座標へ戻すときだけ。sources の取得は同じ座標から対象 DecodedChunk の実寸で添字を計算する（README 参照）。

## 常駐制御・検証

MeshWorld はカメラからチャンク中心までの距離順に作る。quality の面上限は low=200万、medium=500万、high=1,000万、auto は low。上限で距離順の連続した集合を打ち切り、遠方の geometry を dispose して CPU/GPU の参照も外す。構築途中も残りの面予算を超えたチャンクを保持しない。既存チャンクは再利用し、構築中は時間を区切ってイベントループへ戻る。より新しい視点・断面の更新が来たら古い更新を打ち切る。

上限は四角形の面数であり、バイト数・FPSの保証ではない。`stats.meshBytes` は頂点・インデックス配列の合計（1面296 bytes）で、GPUへの複製・構築中の一時配列・scene の配列・JSオブジェクトを含まない。`atlasBytes` は RGBA のサイズ。fps・プロセスメモリは別に測る。

実行状態は `window.viewer.ready` または `#status[data-ready=true]` で確認できる。`window.viewer.metrics` は常駐面数・配列バイト数・フレーム数などの計測用。scene・camera・controls・renderer・meshes もここから検査できる。これは現時点の開発接続点で、#5 の静止画プロトコルは未実装。
