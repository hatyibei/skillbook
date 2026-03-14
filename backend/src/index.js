const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Firestore } = require("@google-cloud/firestore");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const db = new Firestore();
const PORT = process.env.PORT || 8080;

app.use(helmet());
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["https://skillbook-web-140498091344.asia-northeast1.run.app", "http://localhost:3000", "http://localhost:8080"];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (CLI, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // Also allow any *.run.app origin for preview deployments
    if (origin.endsWith(".run.app")) return cb(null, true);
    cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

// ===== Rate Limiting (in-memory, per-instance) =====
const rateLimits = new Map();
function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now - entry.start > windowMs) {
    rateLimits.set(key, { start: now, count: 1 });
    return false; // not limited
  }
  entry.count++;
  if (entry.count > maxRequests) return true; // limited
  return false;
}
// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateLimits) {
    if (now - v.start > 600000) rateLimits.delete(k);
  }
}, 300000);

// ===== Input Sanitization =====
function sanitize(str, maxLen = 500) {
  if (typeof str !== "string") return str;
  return str.slice(0, maxLen).replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]*>/g, "").trim();
}
function sanitizeSkill(data) {
  return {
    ...data,
    name: data.name ? sanitize(data.name, 100) : data.name,
    name_en: data.name_en ? sanitize(data.name_en, 100) : data.name_en,
    description: data.description ? sanitize(data.description, 500) : data.description,
    description_ja: data.description_ja ? sanitize(data.description_ja, 500) : data.description_ja,
    icon: data.icon ? data.icon.slice(0, 10) : data.icon,
    repo: data.repo ? sanitize(data.repo, 200) : data.repo,
    author: data.author ? sanitize(data.author, 50) : data.author,
    // content is SKILL.md — allow longer but still cap
    content: data.content ? data.content.slice(0, 50000) : data.content,
  };
}

// ===== Admin check for bulk operations =====
const ADMIN_KEY = process.env.ADMIN_KEY || "sk_admin_" + require("crypto").randomBytes(16).toString("hex");

// ===== Global Read Rate Limit =====
app.use((req, res, next) => {
  if (req.method === "GET") {
    const ip = req.headers["x-forwarded-for"] || req.ip;
    if (rateLimit(`read:${ip}`, 300, 60000)) {
      return res.status(429).json({ error: "Too many requests. Please slow down." });
    }
  }
  next();
});

// ===== Health Check =====
app.get("/", (req, res) => res.json({
  status: "ok", service: "skillbook-api", version: "0.2.0",
  agent_api: {
    search: "GET /api/agent/search?q=keyword&agent=claude-code",
    discover: "GET /api/agent/discover?agent=claude-code",
    skill: "GET /api/agent/skill/:id",
    install: "GET /api/agent/install/:id",
    publish: "POST /api/agent/publish (Bearer API key required)",
    publish_set: "POST /api/agent/publish-set (Bearer API key required)",
    hint: "Agent-friendly endpoints. Auth: Bearer sk_... header. Register at /api/auth/register to get API key."
  },
  auth_api: {
    register: "POST /api/auth/register {username, email, password, displayName?, favoriteAgent?}",
    login: "POST /api/auth/login {email, password}",
    me: "GET /api/auth/me (Bearer token)",
    profile: "PUT /api/auth/profile (Bearer token) {displayName?, bio?, favoriteAgent?}",
    api_key: "GET /api/auth/api-key (Bearer token)",
    regenerate_key: "POST /api/auth/api-key/regenerate (Bearer token)",
  }
}));

// ===== Skills API =====

// Search skills
app.get("/api/skills", async (req, res) => {
  try {
    const { q, category, agent, rarity, limit = 200, offset = 0 } = req.query;
    const authUser = req.headers.authorization?.replace("Bearer ", "");

    // Simple query — sort client-side to avoid composite index issues
    const snapshot = await db.collection("skills").limit(Number(limit)).get();
    let skills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Filter out private skills unless user is the author
    skills = skills.filter(s => s.visibility !== "private" || s.author === authUser);

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
    const ip = req.headers["x-forwarded-for"] || req.ip;
    if (rateLimit(`skill-pub:${ip}`, 10, 3600000)) return res.status(429).json({ error: "Rate limit: max 10 skills/hour" });

    const sanitized = sanitizeSkill(req.body);
    const { name, name_en, description, description_ja, icon, category, agents, rarity, tags, author, repo, content, visibility } = sanitized;
    if (!name) return res.status(400).json({ error: "name required" });

    const data = {
      name, name_en: name_en || "", icon: icon || "⚔️",
      description: description || "", description_ja: description_ja || "",
      category: category || "general", agents: agents || ["claude-code"],
      rarity: rarity || "common", tags: tags || [], author: author || "anonymous",
      repo: repo || "", content: content || "", visibility: visibility || "public",
      installs: 0, rating: 0, reviewCount: 0,
      createdAt: Firestore.Timestamp.now(), updatedAt: Firestore.Timestamp.now(),
    };

    await db.collection("skills").doc(name).set(data, { merge: true });
    res.json({ ok: true, id: name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk import skills (admin only)
app.post("/api/skills/bulk", async (req, res) => {
  try {
    const adminKey = req.headers["x-admin-key"] || req.headers.authorization?.replace("Bearer ", "");
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: "Admin key required" });

    const { skills } = req.body;
    if (!skills?.length) return res.status(400).json({ error: "skills array required" });

    const batch = db.batch();
    for (const s of skills) {
      if (!s.name) continue;
      const id = s.id || s.name.toLowerCase().replace(/\s+/g, "-");
      const ref = db.collection("skills").doc(id);
      batch.set(ref, {
        name: s.name, name_en: s.name_en || "", icon: s.icon || "⚔️",
        description: s.description || "", description_ja: s.description_ja || "",
        category: s.category || "general", agents: s.agents || ["claude-code"],
        rarity: s.rarity || "common", tags: s.tags || [], author: s.author || "imported",
        repo: s.repo || "", content: s.content || "",
        installs: s.installs || 0, rating: s.rating || 0, reviewCount: s.reviewCount || 0,
        createdAt: Firestore.Timestamp.now(), updatedAt: Firestore.Timestamp.now(),
      }, { merge: true });
    }
    await batch.commit();
    res.json({ ok: true, count: skills.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Skill Sets API =====

// List sets
app.get("/api/sets", async (req, res) => {
  try {
    const { author, limit = 50 } = req.query;
    const authUser = req.headers.authorization?.replace("Bearer ", "");

    const snapshot = await db.collection("skillsets").limit(Number(limit)).get();
    let sets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Filter out private sets unless user is the author
    sets = sets.filter(s => s.visibility !== "private" || s.author === authUser);

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
    const ip = req.headers["x-forwarded-for"] || req.ip;
    if (rateLimit(`set-pub:${ip}`, 10, 3600000)) return res.status(429).json({ error: "Rate limit: max 10 sets/hour" });

    const { name: rawName, description: rawDesc, skills, agents, author: rawAuthor, custom_instructions, icon, visibility } = req.body;
    const name = sanitize(rawName, 100);
    const description = sanitize(rawDesc || "", 500);
    const author = sanitize(rawAuthor || "anonymous", 50);
    if (!name || !skills?.length) return res.status(400).json({ error: "name and skills required" });
    if (skills.length > 50) return res.status(400).json({ error: "max 50 skills per set" });

    const data = {
      name, description, icon: icon ? icon.slice(0, 10) : "📦", skills, agents: agents || ["claude-code"],
      author, custom_instructions: custom_instructions ? custom_instructions.slice(0, 5000) : "", visibility: visibility || "public",
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
    const ip = req.headers["x-forwarded-for"] || req.ip;
    if (rateLimit(`review:${ip}`, 20, 3600000)) return res.status(429).json({ error: "Rate limit: max 20 reviews/hour" });

    const { targetId, targetType, author, rating, comment, agentUsed } = req.body;
    if (!targetId || !rating) return res.status(400).json({ error: "targetId and rating required" });
    if (Number(rating) < 1 || Number(rating) > 5) return res.status(400).json({ error: "rating must be 1-5" });

    const review = {
      targetId: sanitize(targetId, 100), targetType: targetType || "skill",
      author: sanitize(author || "anonymous", 50),
      rating: Number(rating), comment: sanitize(comment || "", 1000),
      agentUsed: sanitize(agentUsed || "unknown", 50),
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
    const ip = req.headers["x-forwarded-for"] || req.ip;
    if (rateLimit(`install:${ip}`, 60, 3600000)) return res.status(429).json({ error: "Rate limit exceeded" });

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

// ===== Auth Middleware =====
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Authorization required" });

  // Check session token
  const sessionSnap = await db.collection("sessions").where("token", "==", token).limit(1).get();
  if (!sessionSnap.empty) {
    const session = sessionSnap.docs[0].data();
    if (session.expiresAt && session.expiresAt.toDate() < new Date()) {
      return res.status(401).json({ error: "Session expired, please login again" });
    }
    req.user = { username: session.username };
    return next();
  }

  // Check API key
  const keySnap = await db.collection("api_keys").where("key", "==", token).limit(1).get();
  if (!keySnap.empty) {
    const keyData = keySnap.docs[0].data();
    if (!keyData.active) return res.status(401).json({ error: "API key revoked" });
    // Update last used
    await keySnap.docs[0].ref.update({ lastUsed: Firestore.Timestamp.now() });
    req.user = { username: keyData.username };
    return next();
  }

  return res.status(401).json({ error: "Invalid token or API key" });
}

// ===== Users API =====

// Get public profile (no auth needed)
app.get("/api/users/:username", async (req, res) => {
  try {
    const doc = await db.collection("users").doc(req.params.username).get();
    if (!doc.exists) return res.status(404).json({ error: "User not found" });
    const data = doc.data();
    // Don't expose password hash or sensitive data
    const { passwordHash, ...publicData } = data;
    res.json({ id: doc.id, ...publicData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Register — email + password
app.post("/api/auth/register", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.ip;
    if (rateLimit(`register:${ip}`, 5, 3600000)) return res.status(429).json({ error: "登録のレート制限に達しました。しばらくしてからお試しください" });

    const { username, email, password, displayName, favoriteAgent } = req.body;

    // Validation
    if (!username || username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: "ユーザー名は2〜20文字で入力してね" });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: "ユーザー名は英数字・ハイフン・アンダースコアのみ" });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "有効なメールアドレスを入力してね" });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "パスワードは6文字以上で設定してね" });
    }

    // Check username taken
    const existing = await db.collection("users").doc(username).get();
    if (existing.exists) {
      return res.status(409).json({ error: "このユーザー名はすでに使われています" });
    }

    // Check email taken
    const emailCheck = await db.collection("users").where("email", "==", email).limit(1).get();
    if (!emailCheck.empty) {
      return res.status(409).json({ error: "このメールアドレスはすでに登録されています" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate API key for agent access
    const apiKey = `sk_${uuidv4().replace(/-/g, "")}`;

    // Create user
    await db.collection("users").doc(username).set({
      username, email, passwordHash,
      displayName: displayName || username,
      favoriteAgent: favoriteAgent || "claude-code",
      bio: "",
      skillsPublished: 0, setsPublished: 0, reviewsWritten: 0,
      createdAt: Firestore.Timestamp.now(), updatedAt: Firestore.Timestamp.now(),
    });

    // Store API key
    await db.collection("api_keys").add({
      key: apiKey, username, name: "default",
      active: true, createdAt: Firestore.Timestamp.now(), lastUsed: null,
    });

    // Create session
    const sessionToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await db.collection("sessions").add({
      token: sessionToken, username,
      createdAt: Firestore.Timestamp.now(),
      expiresAt: Firestore.Timestamp.fromDate(expiresAt),
    });

    res.json({
      ok: true,
      user: { username, displayName: displayName || username, email, favoriteAgent: favoriteAgent || "claude-code" },
      token: sessionToken,
      apiKey,
      expiresAt: expiresAt.toISOString(),
      hint: "Save your API key! Use it as Bearer token for agent API access: Authorization: Bearer sk_..."
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login — email + password
app.post("/api/auth/login", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"] || req.ip;
    if (rateLimit(`login:${ip}`, 10, 900000)) return res.status(429).json({ error: "ログイン試行回数の制限に達しました。15分後にお試しください" });

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "メールアドレスとパスワードを入力してね" });
    }

    // Find user by email
    const snapshot = await db.collection("users").where("email", "==", email).limit(1).get();
    if (snapshot.empty) {
      return res.status(401).json({ error: "メールアドレスまたはパスワードが正しくありません" });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    // Verify password
    const valid = await bcrypt.compare(password, userData.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "メールアドレスまたはパスワードが正しくありません" });
    }

    // Create session
    const sessionToken = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.collection("sessions").add({
      token: sessionToken, username: userData.username,
      createdAt: Firestore.Timestamp.now(),
      expiresAt: Firestore.Timestamp.fromDate(expiresAt),
    });

    const { passwordHash, ...publicUser } = userData;
    res.json({
      ok: true,
      user: publicUser,
      token: sessionToken,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verify token (for frontend session check)
app.get("/api/auth/me", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const sessionSnap = await db.collection("sessions").where("token", "==", token).limit(1).get();
    if (sessionSnap.empty) return res.status(401).json({ error: "Invalid token" });

    const session = sessionSnap.docs[0].data();
    if (session.expiresAt && session.expiresAt.toDate() < new Date()) {
      return res.status(401).json({ error: "Session expired" });
    }

    const userDoc = await db.collection("users").doc(session.username).get();
    if (!userDoc.exists) return res.status(401).json({ error: "User not found" });

    const { passwordHash, ...publicUser } = userDoc.data();
    res.json({ ok: true, user: publicUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Logout
app.post("/api/auth/logout", async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.json({ ok: true });

  try {
    const sessionSnap = await db.collection("sessions").where("token", "==", token).limit(1).get();
    if (!sessionSnap.empty) await sessionSnap.docs[0].ref.delete();
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: true });
  }
});

// Update profile (auth required)
app.put("/api/auth/profile", authMiddleware, async (req, res) => {
  try {
    const { displayName, bio, favoriteAgent } = req.body;
    const updates = { updatedAt: Firestore.Timestamp.now() };
    if (displayName !== undefined) updates.displayName = displayName;
    if (bio !== undefined) updates.bio = bio;
    if (favoriteAgent !== undefined) updates.favoriteAgent = favoriteAgent;

    await db.collection("users").doc(req.user.username).update(updates);
    const doc = await db.collection("users").doc(req.user.username).get();
    const { passwordHash, ...publicUser } = doc.data();
    res.json({ ok: true, user: publicUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Change password (auth required)
app.post("/api/auth/change-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "新しいパスワードは6文字以上で設定してね" });
    }

    const doc = await db.collection("users").doc(req.user.username).get();
    const valid = await bcrypt.compare(currentPassword, doc.data().passwordHash);
    if (!valid) return res.status(401).json({ error: "現在のパスワードが正しくありません" });

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.collection("users").doc(req.user.username).update({ passwordHash: newHash, updatedAt: Firestore.Timestamp.now() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get/regenerate API key (auth required)
app.get("/api/auth/api-key", authMiddleware, async (req, res) => {
  try {
    const snap = await db.collection("api_keys").where("username", "==", req.user.username).where("active", "==", true).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: "No API key found" });
    const data = snap.docs[0].data();
    res.json({ apiKey: data.key, name: data.name, createdAt: data.createdAt, lastUsed: data.lastUsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/api-key/regenerate", authMiddleware, async (req, res) => {
  try {
    // Deactivate old keys
    const oldSnap = await db.collection("api_keys").where("username", "==", req.user.username).get();
    for (const doc of oldSnap.docs) await doc.ref.update({ active: false });

    // Generate new key
    const apiKey = `sk_${uuidv4().replace(/-/g, "")}`;
    await db.collection("api_keys").add({
      key: apiKey, username: req.user.username, name: req.body.name || "default",
      active: true, createdAt: Firestore.Timestamp.now(), lastUsed: null,
    });

    res.json({
      ok: true, apiKey,
      hint: "Use as Bearer token: curl -H 'Authorization: Bearer " + apiKey + "' https://api.skillbook.dev/api/agent/search?q=..."
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Legacy support — redirect old POST /api/users to register
app.post("/api/users", async (req, res) => {
  res.status(301).json({ error: "Use POST /api/auth/register instead", redirect: "/api/auth/register" });
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

// ===== Agent-Friendly API =====
// Designed for AI agents to programmatically search, discover, and install skills

// Agent search — returns compact results optimized for LLM context windows
app.get("/api/agent/search", async (req, res) => {
  try {
    const { q, category, agent, rarity, limit = 20 } = req.query;
    if (!q && !category && !agent) return res.status(400).json({ error: "Provide q, category, or agent parameter" });

    const snapshot = await db.collection("skills").limit(100).get();
    let skills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (category) skills = skills.filter(s => s.category === category);
    if (agent) skills = skills.filter(s => s.agents?.includes(agent));
    if (rarity) skills = skills.filter(s => s.rarity === rarity);
    if (q) {
      const ql = q.toLowerCase();
      skills = skills.filter(s =>
        s.name?.toLowerCase().includes(ql) || s.description?.toLowerCase().includes(ql) ||
        s.description_ja?.toLowerCase().includes(ql) || s.tags?.some(t => t.toLowerCase().includes(ql)) ||
        s.id?.toLowerCase().includes(ql));
    }

    skills.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    skills = skills.slice(0, Number(limit));

    // Compact format for agents
    res.json({
      results: skills.map(s => ({
        id: s.id || doc.id,
        name: s.name,
        name_en: s.name_en || "",
        description: s.description || "",
        description_ja: s.description_ja || "",
        category: s.category,
        rarity: s.rarity,
        agents: s.agents || [],
        tags: s.tags || [],
        rating: s.rating || 0,
        installs: s.installs || 0,
        install_cmd: `npx skillbook install ${s.id || s.name}`,
      })),
      total: skills.length,
      hint: "Use GET /api/agent/skill/:id for full content including SKILL.md"
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent get skill — returns full content including SKILL.md for direct use
app.get("/api/agent/skill/:id", async (req, res) => {
  try {
    const doc = await db.collection("skills").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Skill not found", hint: "Use GET /api/agent/search?q=keyword to find skills" });

    const s = doc.data();
    res.json({
      id: doc.id,
      name: s.name,
      name_en: s.name_en || "",
      description: s.description || "",
      description_ja: s.description_ja || "",
      content: s.content || "",
      category: s.category,
      rarity: s.rarity,
      agents: s.agents || [],
      tags: s.tags || [],
      repo: s.repo || "",
      rating: s.rating || 0,
      installs: s.installs || 0,
      install_cmd: `npx skillbook install ${doc.id}`,
      equip_cmd: `npx skillbook add ${doc.id} --import`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent discover — curated recommendations based on agent type
app.get("/api/agent/discover", async (req, res) => {
  try {
    const { agent = "claude-code", limit = 10 } = req.query;
    const snapshot = await db.collection("skills").limit(100).get();
    let skills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Filter by agent, sort by rating
    skills = skills.filter(s => s.agents?.includes(agent));
    skills.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    skills = skills.slice(0, Number(limit));

    // Also get popular sets
    const setsSnap = await db.collection("skillsets").limit(20).get();
    let sets = setsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    sets.sort((a, b) => (b.installs || 0) - (a.installs || 0));
    sets = sets.slice(0, 5);

    res.json({
      agent,
      recommended_skills: skills.map(s => ({
        id: s.id || s.name, name: s.name, description_ja: s.description_ja || s.description || "",
        rarity: s.rarity, rating: s.rating || 0,
        install_cmd: `npx skillbook install ${s.id || s.name}`,
      })),
      recommended_sets: sets.map(s => ({
        id: s.id || s.name, name: s.name, description: s.description || "",
        skill_count: (s.skills || []).length,
        equip_cmd: `npx skillbook equip "${s.id || s.name}"`,
      })),
      hint: "Use GET /api/agent/skill/:id for full skill content"
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent install — get SKILL.md content directly (for agents to fetch and save)
app.get("/api/agent/install/:id", async (req, res) => {
  try {
    const doc = await db.collection("skills").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Skill not found" });

    const s = doc.data();
    // Track install
    await db.collection("install_events").add({
      skillId: doc.id, agent: req.query.agent || "api", timestamp: Firestore.Timestamp.now(),
    });
    await db.runTransaction(async (t) => {
      const ref = db.collection("skills").doc(doc.id);
      const d = await t.get(ref);
      if (d.exists) t.update(ref, { installs: (d.data().installs || 0) + 1 });
    });

    // Return in a format agents can directly save as SKILL.md
    const skillMd = s.content || `# ${s.name}\n\n${s.description || s.description_ja || ""}\n\n## Metadata\n- Category: ${s.category}\n- Agents: ${(s.agents||[]).join(", ")}\n- Tags: ${(s.tags||[]).join(", ")}`;

    res.json({
      id: doc.id,
      filename: `${doc.id}/SKILL.md`,
      content: skillMd,
      metadata: {
        name: s.name, name_en: s.name_en, category: s.category,
        agents: s.agents, tags: s.tags, rarity: s.rarity,
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent publish skill (API key required)
app.post("/api/agent/publish", authMiddleware, async (req, res) => {
  try {
    const { id, name, name_en, description, description_ja, content, icon, category, rarity, tags, agents, repo } = req.body;
    const skillId = id || name_en?.toLowerCase().replace(/[^a-z0-9]+/g, "-") || name?.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (!skillId || !name) return res.status(400).json({ error: "id/name required" });

    await db.collection("skills").doc(skillId).set({
      name, name_en: name_en || "", icon: icon || "⚔️",
      description: description || "", description_ja: description_ja || "",
      content: content || "", category: category || "general",
      rarity: rarity || "common", tags: tags || [], agents: agents || ["claude-code"],
      repo: repo || "", author: req.user.username,
      installs: 0, rating: 0, reviewCount: 0,
      createdAt: Firestore.Timestamp.now(), updatedAt: Firestore.Timestamp.now(),
    }, { merge: true });

    res.json({
      ok: true, id: skillId,
      url: `https://skillbook-web-140498091344.asia-northeast1.run.app/?skill=${skillId}`,
      install_cmd: `npx skillbook install ${skillId}`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent publish set (API key required)
app.post("/api/agent/publish-set", authMiddleware, async (req, res) => {
  try {
    const { name, description, skills, icon, agents } = req.body;
    if (!name || !skills?.length) return res.status(400).json({ error: "name and skills required" });

    await db.collection("skillsets").doc(name).set({
      name, description: description || "", icon: icon || "📦",
      skills, agents: agents || ["claude-code"], author: req.user.username,
      installs: 0, rating: 0, reviewCount: 0,
      createdAt: Firestore.Timestamp.now(), updatedAt: Firestore.Timestamp.now(),
    }, { merge: true });

    res.json({
      ok: true, id: name,
      equip_cmd: `npx skillbook equip "${name}"`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Edit/Delete Skills (auth required, owner only) =====

app.put("/api/skills/:id", authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection("skills").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Skill not found" });
    if (doc.data().author !== req.user.username) return res.status(403).json({ error: "自分のスキルのみ編集できます" });

    const { name, name_en, description, description_ja, icon, category, rarity, tags, agents, repo, content, visibility } = req.body;
    const updates = { updatedAt: Firestore.Timestamp.now() };
    if (name !== undefined) updates.name = name;
    if (name_en !== undefined) updates.name_en = name_en;
    if (description !== undefined) updates.description = description;
    if (description_ja !== undefined) updates.description_ja = description_ja;
    if (icon !== undefined) updates.icon = icon;
    if (category !== undefined) updates.category = category;
    if (rarity !== undefined) updates.rarity = rarity;
    if (tags !== undefined) updates.tags = tags;
    if (agents !== undefined) updates.agents = agents;
    if (repo !== undefined) updates.repo = repo;
    if (content !== undefined) updates.content = content;
    if (visibility !== undefined) updates.visibility = visibility;

    await db.collection("skills").doc(req.params.id).update(updates);
    const updated = await db.collection("skills").doc(req.params.id).get();
    res.json({ ok: true, id: req.params.id, ...updated.data() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/skills/:id", authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection("skills").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Skill not found" });
    if (doc.data().author !== req.user.username) return res.status(403).json({ error: "自分のスキルのみ削除できます" });

    await db.collection("skills").doc(req.params.id).delete();
    // Also delete related reviews
    const reviewSnap = await db.collection("reviews").where("targetId", "==", req.params.id).get();
    const batch = db.batch();
    reviewSnap.docs.forEach(d => batch.delete(d.ref));
    if (!reviewSnap.empty) await batch.commit();

    res.json({ ok: true, deleted: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== Edit/Delete Sets (auth required, owner only) =====

app.put("/api/sets/:id", authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection("skillsets").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Set not found" });
    if (doc.data().author !== req.user.username) return res.status(403).json({ error: "自分のセットのみ編集できます" });

    const { name, description, skills, icon, agents, visibility } = req.body;
    const updates = { updatedAt: Firestore.Timestamp.now() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (skills !== undefined) updates.skills = skills;
    if (icon !== undefined) updates.icon = icon;
    if (agents !== undefined) updates.agents = agents;
    if (visibility !== undefined) updates.visibility = visibility;

    await db.collection("skillsets").doc(req.params.id).update(updates);
    const updated = await db.collection("skillsets").doc(req.params.id).get();
    res.json({ ok: true, id: req.params.id, ...updated.data() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/sets/:id", authMiddleware, async (req, res) => {
  try {
    const doc = await db.collection("skillsets").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Set not found" });
    if (doc.data().author !== req.user.username) return res.status(403).json({ error: "自分のセットのみ削除できます" });

    await db.collection("skillsets").doc(req.params.id).delete();
    res.json({ ok: true, deleted: req.params.id });
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
