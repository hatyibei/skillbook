const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Firestore } = require("@google-cloud/firestore");

const app = express();
const db = new Firestore();
const PORT = process.env.PORT || 8080;

app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));
app.use(express.json());

// ===== Health Check =====
app.get("/", (req, res) => res.json({ status: "ok", service: "skillbook-api", version: "0.1.0" }));

// ===== Skills API =====

// Search skills
app.get("/api/skills", async (req, res) => {
  try {
    const { q, category, agent, rarity, limit = 20, offset = 0 } = req.query;
    let query = db.collection("skills").orderBy("installs", "desc").limit(Number(limit)).offset(Number(offset));

    if (category) query = query.where("category", "==", category);
    if (agent) query = query.where("agents", "array-contains", agent);
    if (rarity) query = query.where("rarity", "==", rarity);

    const snapshot = await query.get();
    const skills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Client-side text search (Firestore doesn't have full-text search)
    const filtered = q
      ? skills.filter(s =>
          s.name?.includes(q) || s.description?.includes(q) ||
          s.description_ja?.includes(q) || s.tags?.some(t => t.includes(q)))
      : skills;

    res.json({ skills: filtered, total: filtered.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single skill
app.get("/api/skills/:id", async (req, res) => {
  try {
    const doc = await db.collection("skills").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Not found" });
    res.json({ id: doc.id, ...doc.data() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Register/update skill (from CLI publish)
app.post("/api/skills", async (req, res) => {
  try {
    const { name, description, description_ja, category, agents, rarity, tags, author, repo } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });

    const data = {
      name, description: description || "", description_ja: description_ja || "",
      category: category || "general", agents: agents || ["claude-code"],
      rarity: rarity || "COMMON", tags: tags || [], author: author || "anonymous",
      repo: repo || "", installs: 0, rating: 0, reviewCount: 0,
      createdAt: Firestore.Timestamp.now(), updatedAt: Firestore.Timestamp.now(),
    };

    await db.collection("skills").doc(name).set(data, { merge: true });
    res.json({ ok: true, id: name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Skill Sets API =====

// List sets
app.get("/api/sets", async (req, res) => {
  try {
    const { author, limit = 20 } = req.query;
    let query = db.collection("skillsets").orderBy("installs", "desc").limit(Number(limit));
    if (author) query = query.where("author", "==", author);

    const snapshot = await query.get();
    const sets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ sets, total: sets.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single set
app.get("/api/sets/:id", async (req, res) => {
  try {
    const doc = await db.collection("skillsets").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Not found" });
    res.json({ id: doc.id, ...doc.data() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Publish set
app.post("/api/sets", async (req, res) => {
  try {
    const { name, description, skills, agents, author, custom_instructions } = req.body;
    if (!name || !skills?.length) return res.status(400).json({ error: "name and skills required" });

    const data = {
      name, description: description || "", skills, agents: agents || ["claude-code"],
      author: author || "anonymous", custom_instructions: custom_instructions || "",
      installs: 0, rating: 0, reviewCount: 0, forkedFrom: req.body.forkedFrom || null,
      createdAt: Firestore.Timestamp.now(), updatedAt: Firestore.Timestamp.now(),
    };

    await db.collection("skillsets").doc(name).set(data, { merge: true });
    res.json({ ok: true, id: name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Reviews API =====

app.get("/api/reviews/:targetId", async (req, res) => {
  try {
    const snapshot = await db.collection("reviews")
      .where("targetId", "==", req.params.targetId)
      .orderBy("createdAt", "desc").limit(50).get();
    res.json({ reviews: snapshot.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/reviews", async (req, res) => {
  try {
    const { targetId, targetType, author, rating, comment, agentUsed } = req.body;
    if (!targetId || !rating) return res.status(400).json({ error: "targetId and rating required" });

    const review = {
      targetId, targetType: targetType || "skill", author: author || "anonymous",
      rating: Number(rating), comment: comment || "", agentUsed: agentUsed || "unknown",
      createdAt: Firestore.Timestamp.now(),
    };
    const ref = await db.collection("reviews").add(review);

    // Update average rating
    const targetCollection = targetType === "skillset" ? "skillsets" : "skills";
    const targetRef = db.collection(targetCollection).doc(targetId);
    await db.runTransaction(async (t) => {
      const doc = await t.get(targetRef);
      if (!doc.exists) return;
      const data = doc.data();
      const newCount = (data.reviewCount || 0) + 1;
      const newRating = ((data.rating || 0) * (data.reviewCount || 0) + Number(rating)) / newCount;
      t.update(targetRef, { rating: newRating, reviewCount: newCount });
    });

    res.json({ ok: true, id: ref.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Install Tracking =====
app.post("/api/track/install", async (req, res) => {
  try {
    const { skillId, agent, setId } = req.body;
    if (!skillId) return res.status(400).json({ error: "skillId required" });

    // Log install event
    await db.collection("install_events").add({
      skillId, agent: agent || "unknown", setId: setId || null,
      timestamp: Firestore.Timestamp.now(),
    });

    // Increment install count
    const ref = db.collection("skills").doc(skillId);
    await db.runTransaction(async (t) => {
      const doc = await t.get(ref);
      if (!doc.exists) return;
      t.update(ref, { installs: (doc.data().installs || 0) + 1 });
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Categories =====
app.get("/api/categories", async (req, res) => {
  res.json({
    categories: [
      { id: "development", name_ja: "開発", icon: "💻" },
      { id: "data", name_ja: "データ分析", icon: "📊" },
      { id: "document", name_ja: "ドキュメント", icon: "📝" },
      { id: "design", name_ja: "デザイン", icon: "🎨" },
      { id: "business", name_ja: "ビジネス", icon: "💼" },
      { id: "devops", name_ja: "DevOps", icon: "🔧" },
      { id: "security", name_ja: "セキュリティ", icon: "🔒" },
      { id: "general", name_ja: "その他", icon: "📦" },
    ],
  });
});

app.listen(PORT, () => console.log(`📖 SkillBook API listening on :${PORT}`));
