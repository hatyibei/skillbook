/**
 * Firestore初期データ投入スクリプト
 * Usage: GOOGLE_CLOUD_PROJECT=skillbook-490117 node scripts/seed-firestore.js
 */
const { Firestore } = require("@google-cloud/firestore");
const db = new Firestore();

const SKILLS = [
  {
    name: "code-review",
    description: "Comprehensive code review with security, performance, and maintainability analysis",
    description_ja: "セキュリティ・パフォーマンス・保守性を網羅したコードレビュー",
    category: "development", rarity: "LEGENDARY",
    agents: ["claude-code", "codex", "cursor", "copilot"],
    tags: ["TypeScript", "Python", "セキュリティ"], installs: 12400, rating: 4.8, reviewCount: 342,
  },
  {
    name: "design-army",
    description: "Generate non-AI-looking UI designs using brand references and techniques",
    description_ja: "AIっぽくないUIデザインを生成。固有名詞×テクニックで出力の平均化を打破",
    category: "design", rarity: "LEGENDARY",
    agents: ["claude-code"],
    tags: ["UI/UX", "HTML", "React"], installs: 3800, rating: 4.9, reviewCount: 89,
  },
  {
    name: "design-doc-forge",
    description: "Auto-generate requirements, basic design, and detailed design documents",
    description_ja: "要件定義・基本設計・詳細設計書を自動生成。日本語フォーマット対応",
    category: "document", rarity: "EPIC",
    agents: ["claude-code", "copilot"],
    tags: ["docx", "テンプレート", "日本語"], installs: 8200, rating: 4.5, reviewCount: 201,
  },
  {
    name: "data-arrow",
    description: "Automatic EDA + visualization + insight extraction from CSV/Excel",
    description_ja: "CSV/Excelから自動でEDA＋可視化＋インサイト抽出",
    category: "data", rarity: "RARE",
    agents: ["claude-code", "gemini", "codex"],
    tags: ["pandas", "可視化", "Excel"], installs: 6100, rating: 4.3, reviewCount: 156,
  },
  {
    name: "meeting-sorcery",
    description: "Generate structured meeting notes + action items from transcripts",
    description_ja: "音声文字起こしから構造化議事録＋アクションアイテム＋ネクストステップを自動生成",
    category: "business", rarity: "EPIC",
    agents: ["claude-code", "chatgpt"],
    tags: ["議事録", "Whisper", "Slack連携"], installs: 5700, rating: 4.6, reviewCount: 178,
  },
  {
    name: "git-basics",
    description: "Teach agents commit conventions, branch strategy, and PR templates",
    description_ja: "コミットメッセージ規約・ブランチ戦略・PRテンプレートをエージェントに教え込む",
    category: "development", rarity: "COMMON",
    agents: ["claude-code", "cursor", "codex", "copilot", "gemini"],
    tags: ["Git", "CI/CD"], installs: 15300, rating: 4.2, reviewCount: 412,
  },
];

const SKILLSETS = [
  {
    name: "dev-review-set",
    description: "開発レビューセット",
    skills: ["code-review", "git-basics"],
    agents: ["claude-code", "codex"], author: "skillbook-team",
    installs: 2300, rating: 4.7, reviewCount: 56,
  },
  {
    name: "sales-kit",
    description: "営業資料作成セット",
    skills: ["design-army", "design-doc-forge"],
    agents: ["claude-code"], author: "hathibei",
    installs: 1200, rating: 4.5, reviewCount: 34,
  },
  {
    name: "data-analysis-set",
    description: "データ分析セット",
    skills: ["data-arrow"],
    agents: ["claude-code", "gemini"], author: "skillbook-team",
    installs: 890, rating: 4.4, reviewCount: 28,
  },
];

async function seed() {
  console.log("Seeding skills...");
  for (const skill of SKILLS) {
    await db.collection("skills").doc(skill.name).set({
      ...skill,
      createdAt: Firestore.Timestamp.now(),
      updatedAt: Firestore.Timestamp.now(),
    });
    console.log(`  ✓ ${skill.name}`);
  }

  console.log("Seeding skill sets...");
  for (const set of SKILLSETS) {
    await db.collection("skillsets").doc(set.name).set({
      ...set,
      custom_instructions: "",
      forkedFrom: null,
      createdAt: Firestore.Timestamp.now(),
      updatedAt: Firestore.Timestamp.now(),
    });
    console.log(`  ✓ ${set.name}`);
  }

  console.log("\nDone! Seeded", SKILLS.length, "skills and", SKILLSETS.length, "sets.");
}

seed().catch(console.error);
