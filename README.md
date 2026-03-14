<p align="center">
  <img src="https://raw.githubusercontent.com/hatyibei/skillbook/main/docs/logo.png" alt="スキルの書" width="120">
</p>

<h1 align="center">📖 スキルの書 — The SkillBook</h1>

<p align="center">
  <strong>RPG-style skill management for AI agents</strong><br>
  AIエージェントのスキルを探す・装備する・共有する。日本語で読めるスキルカタログ。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/skillbook"><img src="https://img.shields.io/npm/v/skillbook.svg?style=flat-square&color=f0c040" alt="npm"></a>
  <a href="https://skillbooks.dev"><img src="https://img.shields.io/badge/Web-skillbooks.dev-blue?style=flat-square" alt="Web"></a>
  <a href="https://github.com/hatyibei/skillbook/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"></a>
  <a href="https://github.com/hatyibei/skillbook/stargazers"><img src="https://img.shields.io/github/stars/hatyibei/skillbook?style=flat-square&color=f0c040" alt="Stars"></a>
</p>

<p align="center">
  <a href="https://skillbooks.dev">🌐 Web カタログ</a> ・
  <a href="#クイックスタート">🚀 始める</a> ・
  <a href="#コマンド一覧">📋 コマンド</a> ・
  <a href="#対応エージェント">🤖 対応エージェント</a>
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/hatyibei/skillbook/main/docs/demo.gif" alt="SkillBook Demo" width="700">
</p>

## なぜ SkillBook？

AIエージェント（Claude Code, Cursor, Copilot...）が増えるなか、**スキル（SKILL.md / .cursorrules）の管理**が課題になっています。

- プロジェクトごとにスキルファイルを手動コピペしていませんか？
- チームで「この業務にはどのスキルセットがいい？」と迷っていませんか？
- 他の人が作った便利なスキルを探す場所がありませんか？

**SkillBook** はこれを解決します。RPGの装備システムのメタファーで、スキルの**探索・装備・切り替え・共有**をワンコマンドで。

## クイックスタート

```bash
# インストール不要。npxで即実行。
npx skillbook init claude-code

# カタログからスキルを検索
npx skillbook search "コードレビュー"

# スキルを装備
npx skillbook get code-review
npx skillbook get design-army

# スキルセットを作って一括装備
npx skillbook create dev-set --skills code-review,design-army
npx skillbook equip dev-set

# 別の業務に切り替え
npx skillbook unequip
npx skillbook equip sales-kit
```

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

`equip` はシンボリックリンクの張り替えだけ。軽量で高速。

## コマンド一覧

| コマンド | 説明 |
|---------|------|
| `init [agent]` | プロジェクト初期化 |
| `search <query>` | カタログからスキル検索 |
| `get <name>` | スキルをインストール |
| `add <name>` | 新規スキルを追加 |
| `import <path\|url>` | ローカル/Gitからインポート |
| `create <set>` | スキルセットを作成 |
| `equip <set>` | スキルセットを装備 |
| `unequip` | 装備解除 |
| `fork <set>` | セットをフォーク |
| `publish <set>` | npmパッケージとして公開 |
| `list` | 一覧表示 |
| `status` | 現在の状態 |

## 対応エージェント

| エージェント | ステータス |
|-------------|----------|
| Claude Code | ✅ フルサポート |
| Cursor | ✅ フルサポート |
| GitHub Copilot | ✅ フルサポート |
| Codex | ✅ サポート |
| Gemini CLI | ✅ サポート |
| Windsurf | ✅ サポート |
| Goose | ✅ サポート |
| Kiro | ✅ サポート |
| Roo Code | ✅ サポート |

## 三層アーキテクチャ

| Layer | 内容 | 例 |
|-------|------|-----|
| **Layer 1: 素材** | 個別スキル | `code-review`, `design-army` |
| **Layer 2: 合成** | 名前付きスキルセット | `@user/sales-kit` |
| **Layer 3: 組織** | 企業テンプレート | `@company/onboarding` |

## Web カタログ

**[skillbooks.dev](https://skillbooks.dev)** — RPGテーマのスキルカタログサイト。

- 🔍 105+ スキルを日本語で検索
- ⚔️ レアリティ別フィルタ（Common / Rare / Epic / Legendary）
- 📋 SKILL.md のプレビューとワンクリックコピー
- ⭐ コミュニティレビュー
- 🤖 エージェントフレンドリーAPI（`api.skillbooks.dev`）

## Agent API

AIエージェントが直接スキルを検索・取得できるAPI。

```bash
# スキル検索
curl https://api.skillbooks.dev/api/agent/search?q=testing&agent=claude-code

# スキル詳細（SKILL.md含む）
curl https://api.skillbooks.dev/api/agent/skill/tdd-test-generator

# おすすめスキル
curl https://api.skillbooks.dev/api/agent/discover?agent=claude-code
```

## セルフホスト

```bash
git clone https://github.com/hatyibei/skillbook.git
cd skillbook

# バックエンド（要 GCP + Firestore）
cd backend && npm install && npm start

# Web
cd web && npx serve .
```

## Contributing

PRやIssue歓迎です！スキルの追加は特に歓迎。

```bash
# 新しいスキルを追加するには
npx skillbook add my-awesome-skill
# SKILL.mdを編集
# PRを送る
```

## License

MIT

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/hatyibei">AI Tech Lead Team</a>
</p>
