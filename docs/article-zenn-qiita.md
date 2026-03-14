---
title: "AIエージェントのスキル管理、RPGみたいにやったら最高だった話"
emoji: "📖"
type: "tech"
topics: ["claudecode", "cursor", "ai", "cli", "oss"]
published: false
---

## TL;DR

AIエージェント（Claude Code, Cursor, Copilot...）のスキルファイル管理が面倒になったので、RPGの装備システムっぽいCLIとWebカタログを作りました。

**[skillbooks.dev](https://skillbooks.dev)** / **[GitHub](https://github.com/hatyibei/skillbook)** / **[npm](https://www.npmjs.com/package/skillbook)**

```bash
npx skillbook init claude-code
npx skillbook search "コードレビュー"
npx skillbook equip dev-set
```

## 課題: スキルファイルの管理がカオス

Claude Codeの `SKILL.md`、Cursorの `.cursorrules`、みなさんどうやって管理してますか？

自分のチームでは業務効率化エージェントの導入を進める中で、こんな問題にぶつかりました。

**プロジェクトごとにスキルファイルを手動コピペ。** 「あのスキル、どのプロジェクトに入れたっけ...」が頻発。同じスキルの微妙に違うバージョンが散在。

**業務ごとにスキルセットを切り替えたい。** 開発業務なら `code-review` + `tdd-generator`、ドキュメント作成なら `technical-writer` + `api-documentation`。でも毎回手動で差し替えるのは現実的じゃない。

**チーム内でスキルを共有したい。** 「このスキル良いよ」と言われても、Slackでファイルを送り合うのは辛い。

## 解決策: RPGの装備システム

ゲームの装備管理をヒントに、こういう体験を作りました。

```
スキル = 装備アイテム
スキルセット = 装備セット（一括装備/解除）
equip/unequip = 装備/解除コマンド
```

### 1. スキルの探索

```bash
# キーワードで検索
npx skillbook search "テスト"

# Webカタログでも探せる
# https://skillbooks.dev
```

105以上のスキルが登録済み。MCP、Git、セキュリティ、データ分析、ビジネスなど幅広いカテゴリ。

### 2. スキルの装備

```bash
# スキルを取得
npx skillbook get tdd-test-generator
npx skillbook get code-review

# スキルセットにまとめる
npx skillbook create dev-set --skills tdd-test-generator,code-review

# ワンコマンドで装備
npx skillbook equip dev-set
```

`equip` コマンドの裏側はシンボリックリンクの張り替えだけ。`.claude/skills/` にリンクが作られて、Claude Codeが自動で読み込みます。

### 3. 業務に合わせた切り替え

```bash
# 開発モード
npx skillbook equip dev-set

# ドキュメント作成モード
npx skillbook unequip
npx skillbook equip docs-set

# セールスモード
npx skillbook equip sales-kit
```

## 技術的な話

### アーキテクチャ

```
CLI (npm)  ←→  API (Cloud Run)  ←→  Firestore
                    ↑
Web (skillbooks.dev) ← Cloudflare CDN/WAF
```

- **CLI**: Node.js。`npx` で即実行、インストール不要
- **API**: Express + Firestore on GCP Cloud Run（scale-to-zero でコスト最小）
- **Web**: シングルHTML（RPGテーマのUIを全部インライン）
- **CDN/セキュリティ**: Cloudflare Workers でリバースプロキシ + DDoS保護

### セキュリティ

バズったときに死なないよう、以下を実装。

- IP単位のレート制限（登録5回/時、ログイン10回/15分、etc.）
- 入力サニタイズ（XSS対策、長さ制限）
- Admin keyによるbulk操作保護
- CORS制限（特定オリジンのみ）
- Cloudflare WAF + DDoS保護

### Agent API

AIエージェントが直接スキルを検索・取得できるAPIも用意しています。

```bash
# エージェントからスキルを検索
GET https://api.skillbooks.dev/api/agent/search?q=testing&agent=claude-code

# SKILL.mdの内容を直接取得
GET https://api.skillbooks.dev/api/agent/skill/tdd-test-generator
```

レスポンスはLLMのコンテキストウィンドウに最適化されたJSON。

### コスト

Cloud Runのscale-to-zero + Firestoreの無料枠で、トラフィックがない間はほぼ$0。ドメイン代 $10.18/年 のみ。

## Webカタログ

[skillbooks.dev](https://skillbooks.dev) では、RPGの武器屋っぽいUIでスキルを探索できます。

- レアリティ表示（Common / Rare / Epic / Legendary）
- カテゴリフィルタ
- SKILL.mdプレビュー
- CLIコマンドのワンクリックコピー
- レビュー投稿

## 今後の予定

- スキルのバージョン管理
- チーム/組織向けプライベートレジストリ
- エージェント間のスキル互換性チェック
- スキルのA/Bテスト
- VS Code拡張

## まとめ

AIエージェントのスキル管理は、ゲームの装備管理と似ています。業務に合わせてスキルセットを切り替えるワークフローを、CLIとWebカタログで実現しました。

```bash
npx skillbook init claude-code
```

使ってみてフィードバックもらえると嬉しいです。GitHubスターもぜひ。

**リンク:**
- Web: [skillbooks.dev](https://skillbooks.dev)
- GitHub: [github.com/hatyibei/skillbook](https://github.com/hatyibei/skillbook)
- npm: [npmjs.com/package/skillbook](https://www.npmjs.com/package/skillbook)
