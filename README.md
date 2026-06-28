# pmp_learning

[![Deploy to GitHub Pages](https://github.com/long-910/pmp_learning/actions/workflows/deploy.yml/badge.svg)](https://github.com/long-910/pmp_learning/actions/workflows/deploy.yml)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen)](https://long-910.github.io/pmp_learning/)

PMP（Project Management Professional）資格試験 対策Webアプリ

## URL

**https://long-910.github.io/pmp_learning/**

## 概要

- 全218問・3セット
- パスワード保護（デフォルト: `pmp2024`）
- 230分カウントダウンタイマー
- 選択肢シャッフル機能
- ドメイン別フィルタリング
- ダーク／ライトテーマ切り替え
- 結果レポートのHTMLエクスポート
- ダッシュボード（レーダーチャート・棒グラフ・ドーナツチャート・実績バッジ・学習履歴）
- ブックマーク機能・不正解再挑戦モード・学習ストリーク

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

### ブラウザのデベロッパーツール

| ツール | 用途 |
|--------|------|
| Console | JS エラーの確認 |
| Application → Local Storage | 回答・ブックマーク・ストリーク・履歴の保存状態確認・手動削除 |
| Network | 問題ファイルのロード状況確認 |

ローカルストレージのキー一覧：

| キー | 内容 |
|------|------|
| `pmp_study_v1_s0` 〜 `s2` | 各セットの回答・進捗 |
| `pmp_bookmarks_s0` 〜 `s2` | ブックマーク済み問題番号 |
| `pmp_sessions_v1` | 学習履歴（直近20件） |
| `pmp_study_dates` | 学習日一覧（ストリーク計算用） |
| `pmp_theme` | テーマ設定（dark / light） |
