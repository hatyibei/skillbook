# 📖 スキルの書 — The SkillBook

RPGスタイルのAIエージェント・スキルセット管理プラットフォーム。

## 概要

「スキルの書」は、AIエージェント（Claude Code, Codex, Cursor等）のSkillsを**探す・装備する・合成する・共有する**ためのプラットフォームです。RPGの装備システムのメタファーを使い、業務に合わせたスキルセットの切り替えを直感的に行えます。

## クイックスタート

```bash
# 初期化
npx skillbook init claude-code

# スキルを追加
npx skillbook add code-review
npx skillbook add design-army

# スキルセットを作成
npx skillbook create dev-set --skills code-review,design-army --desc "開発セット"

# 装備！
npx skillbook equip dev-set

# 別のセットに切り替え
npx skillbook unequip
npx skillbook equip sales-kit
```

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `init [agent]` | プロジェクト初期化（default: claude-code） |
| `add <name>` | 新規スキルをストアに追加 |
| `import <path\|url>` | ローカル/Gitからスキルをインポート |
| `install <npm-pkg>` | npmからスキルをインストール |
| `create <set>` | スキルセットを作成 |
| `equip <set>` | スキルセットを装備（アクティブ化） |
| `unequip` | 装備解除 |
| `fork <set>` | スキルセットをフォーク |
| `agent [name]` | エージェント切替 |
| `publish <set>` | npm publish用パッケージ準備 |
| `list` | スキル・セット一覧 |
| `status` | 現在の状態表示 |

## 対応エージェント

claude-code, codex, cursor, copilot, gemini, goose, kiro, roo, windsurf

## 仕組み

```
~/.skillbook/
  store/          ← 全スキルの実体（SKILL.md + リソース）
  sets/           ← スキルセット定義（JSON）
  config.json     ← 設定（使用エージェント、プロジェクト等）

.claude/skills/   ← シンボリックリンク（equip時に自動生成）
  code-review → ~/.skillbook/store/code-review
  design-army → ~/.skillbook/store/design-army
```

`equip` コマンドはシンボリックリンクの張り替えだけで動作。バックエンド不要。

## プロジェクト構成

```
skillbook/
  cli/            ← CLI ツール（Node.js）
  backend/        ← GCP Cloud Run API（Express + Firestore）
  web/            ← Webカタログ（静的HTML）
  deploy.sh       ← GCPデプロイスクリプト
  docs/           ← ドキュメント
```

## GCPデプロイ

```bash
# 前提: gcloud CLI 認証済み
chmod +x deploy.sh
./deploy.sh YOUR_PROJECT_ID asia-northeast1
```

デプロイされるもの:
- **Cloud Run (API)**: スキル検索・レビュー・インストール追跡
- **Cloud Run (Web)**: RPGテーマのカタログサイト
- **Firestore**: スキル・セット・レビュー・統計データ

## 三層アーキテクチャ

| Layer | 内容 | 例 |
|-------|------|-----|
| Layer 1: 素材 | 個別スキル | code-review, design-army |
| Layer 2: 合成 | 名前付きスキルセット | @user/sales-kit |
| Layer 3: 組織 | 企業テンプレート | @company/onboarding |

## スキルセットの作成と公開

```bash
# セット作成
npx skillbook create my-set --skills code-review,git-basics --desc "My custom set"

# npm publish用のパッケージを生成
npx skillbook publish my-set --scope your-npm-scope

# 生成されたディレクトリに移動して公開
cd skillbook-my-set && npm publish
```

## License

MIT
