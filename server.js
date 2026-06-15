const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");
const rateLimit = require("express-rate-limit");

const app = express();

/* =========================
   BODY PARSER
========================= */
app.use(express.json({ limit: "1mb" }));

/* =========================
   CORS (GitHub Pages SAFE)
========================= */
app.use(cors({
  origin: [
    "https://rrmayore.github.io",
    "http://localhost:3000"
  ],
  methods: ["GET", "POST"],
}));

/* =========================
   RATE LIMITING
========================= */
app.use("/stkpush", rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests, slow down" }
}));

/* =========================
   FIREBASE INIT
========================= */
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

/* =========================
   ENV
========================= */
const CALLBACK_SECRET = process.env.CALLBACK_SECRET;

/* =========================
   RBAC
========================= */
const USER_ROLES = {
  "admin@harambeeflow.com": "admin",
  "finance@harambeeflow.com": "finance",
  "viewer@harambeeflow.com": "viewer"
};

/* =========================
   AUTH MIDDLEWARE
========================= */
async function verifyAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);

    if (!decoded?.email) {
      return res.status(403).json({ error: "Invalid token" });
    }

    const role = USER_ROLES[decoded.email];

    if (!role) {
      return res.status(403).json({ error: "No role assigned" });
    }

    req.user = { email: decoded.email, role };
    next();

  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({ error: "Authentication failed" });
  }
}

/* =========================
   VALIDATION
========================= */
function validateSTKInput(req, res, next) {
  const { phone, amount } = req.body;

  if (!phone || !amount) {
    return res.status(400).json({ error: "Phone and amount required" });
  }

  if (isNaN(amount) || amount <= 0 || amount > 100000) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  next();
}

/* =========================
   DARAJA CONFIG
========================= */
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const shortcode = process.env.BUSINESS_SHORT_CODE;
const passkey = process.env.PASSKEY;
const callbackUrl = process.env.CALLBACK_URL;

/* =========================
   ACCESS TOKEN
========================= */
async function getAccessToken() {
  const url =
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const res = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` }
  });

  return res.data.access_token;
}

/* =========================
   STK PUSH
========================= */
app.post("/stkpush", validateSTKInput, async (req, res) => {
  try {

    const { name = "Anonymous", phone, amount } = req.body;

    const token = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:\.Z]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      shortcode + passkey + timestamp
    ).toString("base64");

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Number(amount),
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: "HarambeeFlow",
      TransactionDesc: "Donation",
    };

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    await db.collection("donations").add({
      name,
      phone,
      amount: Number(amount),
      checkoutRequestID: response.data.CheckoutRequestID,
      merchantRequestID: response.data.MerchantRequestID,
      status: "pending",
      createdAt: new Date(),
    });

    res.json(response.data);

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "STK Push failed" });
  }
});

/* =========================
   CALLBACK
========================= */
app.post("/callback", async (req, res) => {
  try {

    const secret = req.headers["x-callback-secret"];
    if (CALLBACK_SECRET && secret !== CALLBACK_SECRET) {
      return res.status(403).json({ error: "Invalid callback secret" });
    }

    const callback = req.body?.Body?.stkCallback;

    if (!callback?.CheckoutRequestID) {
      return res.status(400).json({ error: "Invalid callback" });
    }

    const status = callback.ResultCode === 0 ? "completed" : "failed";

    const snap = await db.collection("donations")
      .where("checkoutRequestID", "==", callback.CheckoutRequestID)
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];

      if (doc.data().status === "pending") {
        await doc.ref.update({
          status,
          callbackData: callback,
          updatedAt: new Date(),
        });
      }
    }

    res.json({ ResultCode: 0 });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Callback failed" });
  }
});

/* =========================
   🔥 FIXED: PUBLIC STATS (IMPORTANT)
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
    res.status(500).json({ error: "Stats error" });
  }
});

/* =========================
   PROTECTED DONATIONS
========================= */
app.get("/donations", verifyAdmin, async (req, res) => {
  try {

    if (!["admin", "finance"].includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const snap = await db.collection("donations").get();

    const donations = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json(donations);

  } catch (err) {
    res.status(500).json({ error: "Fetch error" });
  }
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("HarambeeFlow Enterprise Backend 🚀");
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
