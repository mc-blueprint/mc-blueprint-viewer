# 性能測定の固定条件（NFR11）

2026-11-02、Issue #1 で初期基準を固定する。生成器は scripts/generate-scenes.mjs の fixture-v1、Minecraft 1.21.11。版・生成器・寸法・品質を変えた測定は別系列にする。

## 基準端末とブラウザ

| 項目 | 値 |
|---|---|
| OS | Windows 11 Pro 10.0.26200 |
| CPU | AMD Ryzen 7 5700X 8-Core Processor |
| GPU | NVIDIA GeForce RTX 4070 SUPER |
| RAM | 約64GiB（OSから取得: 68,640,256,000 bytes） |
| ブラウザ | Microsoft Edge 156.0.4314.58（Chromium、初期基準） |
| 実行環境 | Node 24.22.1 / npm 11.21.1 |

この端末は内蔵GPUの想定端末ではない。最終目標「内蔵GPU、low で約30fps」の達成をこの端末の結果だけで判断しない。ブラウザ更新時はバージョンを別記して比較する。

## 代表シーン

`npm run fixtures -- 1.21.11` で生成する。乱数・外部データ・時刻に依存しない。Mojangの資産を含めない。

| 名前 | 寸法 | 内容 | JSONのSHA-256 |
|---|---|---|---|
| representative | 32×16×16 | 代表ブロック・重み付き chorus plant・multipart・特殊描画・光源 | eb70895c15e0b6a2b42893a67d7ffa3aeaca84dfbdc13ccc0d32ebeb86a142f8 |
| castle | 256×128×256 | 城壁・隅塔・中央の主塔 | 99bc690537ca7c96e7acde19f7ffb1531095b145c807acebfe580a237dd7689a |
| town | 256×128×256 | 格子状の街路と繰り返し建物 | 774bf9b347baadd2f6fed2f507bc749d7a0cb095ec05609607e3ca6c01d90959 |
| terrain | 256×128×256 | 起伏した地形と水面 | 775c24576885645a67bd7ffd1e707becb31508ef2c14c03e86132fccae0a911f |
| underground | 256×128×256 | 地下の直交通路と空洞 | 26027e4d9d6c797bc77058a5fa425c48a198bc113b5d3f1c2b286d2a35588fc1 |
| vegetation | 256×128×256 | 幹と透過する葉の密集 | e5afbed9d81091abeea9ef853dbb7dbdeb240a6c5c954189b0697ed6a0e2b13c |

## 初期の読み込み測定

`npm run benchmark:scene`。gzipファイルの読み取り後から、gzip展開・SHA-256・JSON解析・スキーマ検証・配列展開が完了するまで。各sceneを順番に1回実行した値であり、統計的な性能保証ではない。

| scene | チャンク | gzip bytes | 読み込み ms | プロセスの累積ピークRSS MiB |
|---|---:|---:|---:|---:|
| representative | 2 | 1,205 | 14 | 107 |
| castle | 463 | 98,484 | 855 | 262 |
| town | 512 | 131,541 | 971 | 368 |
| terrain | 297 | 78,093 | 556 | 368 |
| underground | 768 | 195,898 | 2,062 | 420 |
| vegetation | 256 | 70,932 | 712 | 420 |

RSSは同一Nodeプロセスでの累積最大値で、ViteのSSR読み込みも含む。scene単体のメモリ量・ブラウザのメモリ量ではない。計測順は表の順。

## 描画が接続された後の測定手順

品質 low、shader vanilla、影なし、brightness 0.5、timeOfDay 6000、blockLight 有効、viewport 1280×720、deviceScaleFactor 1。視点は位置 `size × 1.8`、注視点 `size / 2`、FOV 50度（現在の雛形と同じ）で開始する。

アセット展開済み・ブラウザキャッシュなしの初回表示時間（要求開始からアセット・メッシュ・光の準備完了まで）、安定後10秒のfps、常駐面数、ブラウザのピークメモリを各sceneで3回測り中央値を残す。プロセスRSSとGPUメモリは区別する。#1 はメッシュ・光が未実装のため、初回描画・面数・fps は未測定。境界箱の描画をブロック描画の測定として扱わない。

未達時の品質低下順は viewer.md に従い、シェーダー → 影 → AO → 描画距離。representative の固定視点の見た目と全4版の確認はメッシュ・特殊描画の接続後に実施する。
