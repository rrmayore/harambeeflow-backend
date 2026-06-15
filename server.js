const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");
const rateLimit = require("express-rate-limit");

const app = express();

/* =========================
   ENV DEBUG
========================= */
console.log("🔥 ENV CHECK:", {
  project: !!process.env.FIREBASE_PROJECT_ID,
  email: !!process.env.FIREBASE_CLIENT_EMAIL,
  key: !!process.env.FIREBASE_PRIVATE_KEY,
});

/* =========================
   MIDDLEWARE
========================= */
app.use(express.json({ limit: "1mb" }));

app.use(cors({
  origin: [
    "https://rrmayore.github.io",
    "http://localhost:3000"
  ],
  methods: ["GET", "POST"],
}));

app.use("/stkpush", rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests" }
}));

/* =========================
   FIREBASE INIT
========================= */
if (
  !process.env.FIREBASE_PROJECT_ID ||
  !process.env.FIREBASE_CLIENT_EMAIL ||
  !process.env.FIREBASE_PRIVATE_KEY
) {
  console.error("❌ Missing Firebase ENV variables");
  process.exit(1);
}

let db;

try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });

  db = admin.firestore();
  console.log("✅ Firebase connected");

} catch (err) {
  console.error("❌ Firebase init failed:", err);
  process.exit(1);
}

/* =========================
   CALLBACK SECRET
========================= */
const CALLBACK_SECRET = process.env.CALLBACK_SECRET;

/* =========================
   REALTIME DONATIONS (LIVE FEED)
========================= */
app.get("/realtime-donations", async (req, res) => {
  try {
    const snap = await db.collection("donations")
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const data = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    res.json(data);

  } catch (err) {
    console.error("REALTIME ERROR:", err);
    res.status(500).json({ error: "Realtime fetch failed" });
  }
});

/* =========================
   STATS (GLOBAL DASHBOARD)
========================= */
app.get("/stats", async (req, res) => {
  try {
    const snap = await db.collection("donations").get();

    let total = 0;
    let completed = 0;
    let pending = 0;
    let failed = 0;

    const donations = [];

    snap.forEach(doc => {
      const d = doc.data();

      total += Number(d.amount || 0);

      if (d.status === "completed") completed++;
      else if (d.status === "pending") pending++;
      else failed++;

      donations.push({ id: doc.id, ...d });
    });

    res.json({ total, completed, pending, failed, donations });

  } catch (err) {
    console.error("STATS ERROR:", err);
    res.status(500).json({ error: "Stats error" });
  }
});

/* =========================
   🏦 FUNDRAISERS (V6 CORE FEATURE)
========================= */

/**
 * CREATE FUNDRAISER
 */
app.post("/fundraiser", async (req, res) => {
  try {
    const {
      name,
      target,
      description,
      shortcode,
      accountRef,
      treasurerPhone
    } = req.body;

    if (!name || !target || !shortcode) {
      return res.status(400).json({
        error: "Missing required fields (name, target, shortcode)"
      });
    }

    const doc = await db.collection("fundraisers").add({
      name,
      target: Number(target),
      description: description || "",
      shortcode,
      accountRef: accountRef || `REF-${Date.now()}`,
      treasurerPhone: treasurerPhone || "",
      createdAt: new Date()
    });

    res.json({
      id: doc.id,
      message: "Fundraiser created successfully"
    });

  } catch (err) {
    console.error("FUNDRAISER ERROR:", err);
    res.status(500).json({ error: "Failed to create fundraiser" });
  }
});

/**
 * GET ALL FUNDRAISERS
 */
app.get("/fundraisers", async (req, res) => {
  try {
    const snap = await db.collection("fundraisers")
      .orderBy("createdAt", "desc")
      .get();

    const data = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    res.json(data);

  } catch (err) {
    console.error("FUNDRAISERS FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to fetch fundraisers" });
  }
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("HarambeeFlow Backend V6 🚀 (Fundraiser System Active)");
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
