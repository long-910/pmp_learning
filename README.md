# pmp_learning

[![Deploy to GitHub Pages](https://github.com/long-910/pmp_learning/actions/workflows/deploy.yml/badge.svg)](https://github.com/long-910/pmp_learning/actions/workflows/deploy.yml)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen)](https://long-910.github.io/pmp_learning/)

PMP（Project Management Professional）資格試験 対策Webアプリ

## URL

**https://long-910.github.io/pmp_learning/**

## 概要

全302問・5セット構成のPMP試験対策アプリ。外部ライブラリ不使用・静的HTMLのみで動作。

## セット構成

| セット | 範囲 | 問題数 |
|--------|------|--------|
| Set 1 | プロジェクト統合・スコープ・スケジュール・コスト | 89問 |
| Set 2 | 品質・資源・コミュニケーション・リスク・調達・ステークホルダー | 83問 |
| Set 3 | アジャイル・ハイブリッド・リーダーシップ・ピープル | 55問 |
| Set 4 | ビジネス環境・PMI倫理・上位応用シナリオ | 39問 |
| Set 5 | 総合模擬試験（全ドメイン混合） | 36問 |

## 主な機能

### 問題形式（PMP試験準拠）
- **単一選択問題**（4択）
- **複数選択問題**（5択から複数を選ぶ）— チェックボックス式 UI・選択数カウンター・確定ボタン
- **選択肢別解説** — 回答後に各選択肢の「なぜ正解／不正解か」を表示
- **レビューマーク（🚩）** — Pearson VUE と同様のマーク機能
- 選択肢シャッフル（毎回ランダム配置）

### 学習支援
- **230分カウントダウンタイマー**（PMP試験時間）
- **ブックマーク（★）** — 重要問題をマーク、フィルターで絞り込み
- **不正解再挑戦モード** — 間違えた問題だけリセットして再挑戦
- **ドメイン別フィルター** — 特定ドメインに絞って学習

### ダッシュボード・分析
- **SVGレーダーチャート** — ドメイン別正答率（70%合格基準線付き）
- **横棒グラフ** — ドメイン別正答率比較
- **ドーナツチャート** — セット別 正答率／進捗
- **苦手ドメインアラート** — 正答率50%未満を自動検出
- **学習履歴** — 直近10回の結果を記録
- **学習ストリーク** — 連続学習日数カウント

### モチベーション
- **実績バッジ10種** — 初回回答・全問完走・合格圏・ドメイン完璧・3/7日連続・複数選択マスターなど
- **コンフェッティ演出** — 正答率70%以上達成時

### その他
- パスワード保護（デフォルト: `pmp2024`）
- ダーク／ライトテーマ切り替え
- 結果レポートのHTMLエクスポート・PDF印刷
- キーボード操作（`←` `→` 前後移動、`A`–`D` 選択、`M` レビューマーク）
- LocalStorage によるオフライン進捗保存

## ローカルでのデバッグ方法

`index.html` をブラウザで直接開く（`file://`）と、問題ファイル（`set-0.js` 等）の動的ロードが CORS エラーで失敗します。**ローカルサーバーを起動してアクセスしてください。**

### Python（Mac 標準搭載・追加インストール不要）

```bash
cd /path/to/pmp_learning
python3 -m http.server 8080
```

ブラウザで <http://localhost:8080> を開く。

### Node.js

```bash
npx serve .
```

### VS Code

拡張機能 **Live Server**（ritwickdey.LiveServer）をインストールし、`index.html` を右クリック →「Open with Live Server」。ファイル保存時に自動リロードされるため開発に便利。

## ファイル構成

```
pmp_learning/
├── index.html          # アプリ本体（HTML + CSS）
├── quiz.js             # クイズロジック（問題描画・採点・ダッシュボード）
├── questions.js        # ALL_SETS 配列の初期化（5セット分）
├── set-0.js            # Set 1 問題データ（89問）
├── set-1.js            # Set 2 問題データ（83問）
├── set-2.js            # Set 3 問題データ（55問）
├── set-3.js            # Set 4 問題データ（39問）
├── set-4.js            # Set 5 問題データ（36問）
├── set-0-oe.js         # Set 1 選択肢別解説
├── set-1-oe.js         # Set 2 選択肢別解説
├── set-2-oe.js         # Set 3 選択肢別解説
├── set-3-oe.js         # Set 4 選択肢別解説
└── set-4-oe.js         # Set 5 選択肢別解説
```

## ブラウザのデベロッパーツール

| ツール | 用途 |
|--------|------|
| Console | JS エラーの確認 |
| Application → Local Storage | 回答・ブックマーク・ストリーク・履歴の保存状態確認・手動削除 |
| Network | 問題ファイルのロード状況確認 |

### LocalStorage キー一覧

| キー | 内容 |
|------|------|
| `pmp_study_v1_s0` 〜 `s4` | 各セットの回答・進捗・タイマー |
| `pmp_bookmarks_s0` 〜 `s4` | ブックマーク済み問題番号 |
| `pmp_sessions_v1` | 学習履歴（直近20件） |
| `pmp_study_dates` | 学習日一覧（ストリーク計算用） |
| `pmp_theme` | テーマ設定（dark / light） |
