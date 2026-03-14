# SNS投稿テンプレート

## X (Twitter) — 日本語

### メイン投稿
```
📖 スキルの書 — AI エージェントのスキル管理をRPG化した

Claude Code / Cursor / Copilot のスキルファイル、プロジェクトごとにコピペしてない？

npx skillbook equip dev-set

で業務ごとにスキルセットを一括切り替え。105+スキルのWebカタログ付き。

🌐 https://skillbooks.dev
🔗 https://github.com/hatyibei/skillbook

#ClaudeCode #Cursor #AI #OSS
```

### ショート版
```
AIエージェントのSKILL.md管理がカオスだったので、RPGの装備システムっぽいCLIを作った📖

npx skillbook init claude-code
npx skillbook equip dev-set

https://skillbooks.dev
#ClaudeCode #AI
```

### スレッド追加投稿
```
仕組み:
- equip = シンボリックリンクの張り替え（高速）
- 105+ スキル登録済み
- Webカタログは完全RPGテーマ
- Agent APIでAIから直接検索可能
- GCP Cloud Run + Cloudflare で運用コストほぼ$0
```

## X (Twitter) — English

### Main post
```
📖 The SkillBook — RPG-style skill management for AI agents

Managing SKILL.md files across projects is chaos. SkillBook lets you:

npx skillbook equip dev-set

Search, equip & swap skill sets for Claude Code, Cursor, Copilot in one command. 105+ skills with a web catalog.

🌐 https://skillbooks.dev
🔗 https://github.com/hatyibei/skillbook
```

### Short version
```
Made an RPG-style skill manager for AI agents 📖

Like equipment sets in games, but for Claude Code / Cursor skills.

npx skillbook init claude-code
npx skillbook equip dev-set

https://skillbooks.dev
```

## Reddit — r/ClaudeAI or r/ChatGPTCoding

### Title
```
I built an RPG-style skill manager for AI agents (Claude Code, Cursor, Copilot) — The SkillBook
```

### Body
```
Hey everyone,

I've been using Claude Code and Cursor heavily and got tired of manually copying SKILL.md / .cursorrules files between projects. So I built SkillBook — an RPG-style skill management system for AI agents.

**What it does:**
- Search 105+ community skills from CLI or web catalog
- "Equip" skill sets per project (uses symlinks, instant switching)
- Supports 9 AI agents: Claude Code, Cursor, Copilot, Codex, Gemini, etc.
- Web catalog at skillbooks.dev with RPG theme (rarity tiers, reviews)
- Agent API for AI-to-AI skill discovery

**Quick start:**
```
npx skillbook init claude-code
npx skillbook search "code review"
npx skillbook equip dev-set
```

**Links:**
- Web: https://skillbooks.dev
- GitHub: https://github.com/hatyibei/skillbook
- npm: https://www.npmjs.com/package/skillbook

Built with Express + Firestore + Cloudflare. Self-hostable.

Would love feedback!
```

## YouTube Short / TikTok — スクリプト (30-60秒)

### 構成
```
[0-5秒] フック
「AIエージェントのスキル管理、こうやってない？」
→ プロジェクトフォルダ間でSKILL.mdをコピペしてる画面

[5-15秒] 問題提起
「プロジェクトごとにスキルファイルをコピペ...
チームで共有するにはSlackでファイル送る...
業務によってスキルを切り替えたいけど手動...」

[15-35秒] 解決策デモ
→ ターミナルで:
npx skillbook init claude-code
npx skillbook search "コードレビュー"
→ Webカタログ (skillbooks.dev) を見せる
→ カードクリック → SKILL.md表示
npx skillbook equip dev-set
→ .claude/skills/ にシンボリックリンクが生成される様子

[35-50秒] 特徴
「105以上のスキルが登録済み」
「ワンコマンドでスキルセット切り替え」
「RPGの装備管理みたいにスキルを管理」

[50-60秒] CTA
「リンクはプロフィールに。GitHub スターお願いします」
→ skillbooks.dev の画面
```

### BGM参考
レトロゲーム風BGM（著作権フリー）
- DOVA-SYNDROME: 8bit系
- 甘茶の音楽工房: ファンタジー系
