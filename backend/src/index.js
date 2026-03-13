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
    const { q, category, agent, rarity, limit = 50, offset = 0 } = req.query;
    // Simple query — sort client-side to avoid composite index issues
    const snapshot = await db.collection("skills").limit(Number(limit)).get();
    let skills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Client-side filtering
    if (category) skills = skills.filter(s => s.category === category);
    if (agent) skills = skills.filter(s => s.agents?.includes(agent));
    if (rarity) skills = skills.filter(s => s.rarity === rarity);
    if (q) skills = skills.filter(s =>
      s.name?.includes(q) || s.description?.includes(q) ||
      s.description_ja?.includes(q) || s.tags?.some(t => t.includes(q)));

    skills.sort((a, b) => (b.installs || 0) - (a.installs || 0));

    res.json({ skills, total: skills.length });
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
    const { author, limit = 50 } = req.query;
    const snapshot = await db.collection("skillsets").limit(Number(limit)).get();
    let sets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    if (author) sets = sets.filter(s => s.author === author);
    sets.sort((a, b) => (b.installs || 0) - (a.installs || 0));
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
    // Simple query without orderBy to avoid composite index requirement
    const snapshot = await db.collection("reviews")
      .where("targetId", "==", req.params.targetId)
      .limit(50).get();
    const reviews = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.createdAt?._seconds || 0;
        const tb = b.createdAt?._seconds || 0;
        return tb - ta;
      });
    res.json({ reviews });
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

// ===== Users API =====

// Get or create user profile
app.get("/api/users/:username", async (req, res) => {
  try {
    const doc = await db.collection("users").doc(req.params.username).get();
    if (!doc.exists) return res.status(404).json({ error: "User not found" });
    res.json({ id: doc.id, ...doc.data() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    const { username, displayName, bio, favoriteAgent } = req.body;
    if (!username || username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: "username must be 2-20 characters" });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: "username must be alphanumeric with _ or -" });
    }

    const existing = await db.collection("users").doc(username).get();
    if (existing.exists) {
      // Update existing
      await db.collection("users").doc(username).update({
        displayName: displayName || existing.data().displayName,
        bio: bio !== undefined ? bio : existing.data().bio,
        favoriteAgent: favoriteAgent || existing.data().favoriteAgent,
        updatedAt: Firestore.Timestamp.now(),
      });
    } else {
      // Create new
      await db.collection("users").doc(username).set({
        username, displayName: displayName || username,
        bio: bio || "", favoriteAgent: favoriteAgent || "claude-code",
        skillsPublished: 0, setsPublished: 0, reviewsWritten: 0,
        createdAt: Firestore.Timestamp.now(), updatedAt: Firestore.Timestamp.now(),
      });
    }
    const doc = await db.collection("users").doc(username).get();
    res.json({ ok: true, user: { id: doc.id, ...doc.data() } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get user's sets
app.get("/api/users/:username/sets", async (req, res) => {
  try {
    const snapshot = await db.collection("skillsets")
      .where("author", "==", req.params.username).limit(50).get();
    const sets = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ sets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get user's reviews
app.get("/api/users/:username/reviews", async (req, res) => {
  try {
    const snapshot = await db.collection("reviews")
      .where("author", "==", req.params.username).limit(50).get();
    const reviews = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ reviews });
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
