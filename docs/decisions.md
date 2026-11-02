# viewer の依存と設計判断

確認日: 2026-11-02。設計の正本はワークスペース `.github-private/docs/viewer.md`、D16 は同 `decisions.md`。

## 描画ライブラリ（Issue #1）

deepslate 0.27.2 ＋ three.js 0.187.0 を採用する。モデル解決と描画を分け、scene が持つ属性・光・チャンク常駐制御を使える構成にする。

| 観点 | deepslate 0.27.2 ＋ three.js | Lodestone 0.6.0 |
|---|---|---|
| D16 / 資産 | npm の配布対象は lib・dist。既定リソースパックはなく、呼出し側からモデル・テクスチャを供給する。資産なしで multipart を解決できることをテスト済み | 独自 Resources を渡せるが npm 配布対象の assets に既定パックが含まれる。採用には配布経路全体で除外の確認が必要 |
| 重み付きモデル | getModelVariants は配列先頭だけを選ぶ。座標に基づく重み付き選択の補完が必要 | 同じく配列先頭を選ぶ。導入だけでは解決しない |
| uvlock | 値は保持するが getMesh の回転処理では適用しない。UV 補正が必要 | 値は保持するが getMesh で適用しない |
| multipart | 条件・OR・AND・値の OR を解決できる | 条件・OR・値の OR はあるが確認した実装には AND の処理がない |
| 保守状況 | npm 更新 2026-09-27。Minecraft の処理を幅広く持つ上流 | npm 更新 2026-06-03。deepslate を元に three.js 描画を統合する派生 |
| ライセンス | 両方 MIT | MIT（コード）。同梱のゲーム資産の配布権を MIT と扱わない |

Lodestone の統合済み描画は便利だが、既定パック除外と独自光計算・常駐制御への調整が増える。上流のモデル処理を再利用して必要な差分だけ #2 で補う。独自モデルパーサーはここでは実装しない。

一次情報:

- [deepslate package.json](https://github.com/misode/deepslate/blob/master/package.json)、[BlockDefinition](https://github.com/misode/deepslate/blob/master/src/render/BlockDefinition.ts)。導入済み 0.27.2 の lib/render/BlockDefinition.js でも選択・UV処理を照合。
- [Lodestone package.json](https://github.com/mattzh72/lodestone/blob/main/package.json)、[独自 Resources](https://github.com/mattzh72/lodestone#custom-resource-packs)、[BlockDefinition](https://github.com/mattzh72/lodestone/blob/main/src/render/BlockDefinition.ts)、[未対応範囲](https://github.com/mattzh72/lodestone/blob/main/docs/unsupported.md)。確認時点の package.json は 0.6.0。

## 固定依存と NFR10

直接依存は package.json に完全な版、推移依存は package-lock.json に固定する。Node 24.x / npm 11.x を使用する。

| 用途 | パッケージと固定版 | ライセンス |
|---|---|---|
| ブラウザ実行 | three 0.187.0、deepslate 0.27.2、ajv 8.20.0 | MIT |
| ビルド | typescript 5.9.3 / vite 8.3.5 | Apache-2.0 / MIT |
| lint | eslint 10.14.0、@eslint/js 10.0.1、typescript-eslint 8.72.1 | MIT |
| テスト・開発時の ZIP 展開 | vitest 5.0.5、fflate 0.8.3 | MIT |
| 型定義 | @types/node 24.10.1、@types/three 0.187.0 | MIT |

インストール済み package.json と lockfile の license を確認した。ブラウザ向け依存の推移依存は MIT・BSD-3-Clause・MIT AND Zlib。開発時の推移依存には BSD-2-Clause・ISC・Apache-2.0、minimatch と @isaacs/nonrecursive-glob-match の BlueOak-1.0.0、Vite の lightningcss の MPL-2.0 もある。lightningcss はビルドツールで、静的配布物にそのコードを含めない。AGPL・非商用の依存はない。

[Blue Oak の許諾](https://blueoakcouncil.org/license/1.0.0)は利用・改変・配布を許し、ライセンス本文またはリンクの通知を要求する。配布する実行依存のライセンス文は `npm run build` で dist/THIRD_PARTY_LICENSES.txt に同梱する。

初回導入で検出された fflate <0.8.3 の ZIP64 問題は 0.8.3 へ更新した。minimatch <11.0.1 の問題は override 11.0.4 で回避し、ESLint/TypeScript-ESLint が使う API は lint の実行で確認した。この override は上流が修正版へ追従した際に削除を検討する。更新後の npm audit は0件。

## scene と開発用 API

gzip はブラウザ標準 DecompressionStream、SHA-256 は Web Crypto、Draft 2020-12 は Ajv を使う。標準機能で足りるため gzip ライブラリを追加しない。base64 の長さ・実寸・参照先など JSON Schema だけで表せない契約は src/scene/load.ts で確認する。edits 用のハッシュは JSON を再直列化せず、展開直後の元のバイト列から求める。

開発 API は Vite の configureServer のみで有効にし、静的配布物には含めない。GET の scene/asset だけを提供し、固定 dev トークンと Host・Origin・実パス境界を検査する。events / edits / regenerate は後続のサーバー実装の責務。
