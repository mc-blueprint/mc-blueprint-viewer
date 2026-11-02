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

設計段階。Minecraft の jar・テクスチャ・モデルはこのリポジトリと配布物に含めない。テクスチャは利用者の端末で mc-blueprint が展開したものを読む。

本プロジェクトは非公式で、Mojang Studios・Microsoft とは関係ありません。
