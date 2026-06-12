const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");
const rateLimit = require("express-rate-limit");

const app = express();

app.use(express.json());

/* =========================
   CORS LOCK
========================= */
app.use(cors({
  origin: "https://rrmayore.github.io"
}));

/* =========================
   RATE LIMITING
========================= */
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many requests, slow down" }
});

app.use("/stkpush", limiter);

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
   🔐 ENTERPRISE SECRET KEY (NEW)
========================= */
const CALLBACK_SECRET = process.env.CALLBACK_SECRET;

/* =========================
   RBAC SYSTEM
========================= */
const USER_ROLES = {
  "admin@harambeeflow.com": "admin",
  "finance@harambeeflow.com": "finance",
  "viewer@harambeeflow.com": "viewer"
};

/* =========================
   AUDIT LOGS
========================= */
async function logAction(user, action) {
  try {
    await db.collection("audit_logs").add({
      email: user.email,
      role: user.role,
      action,
      time: new Date()
    });
  } catch (e) {
    console.error("Audit log failed:", e);
  }
}

/* =========================
   AUTH + RBAC GUARD
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
      return res.status(403).json({ error: "Invalid token email" });
    }

    const role = USER_ROLES[decoded.email];

    if (!role) {
      return res.status(403).json({ error: "No role assigned" });
    }

    req.user = {
      email: decoded.email,
      role
    };

    next();

  } catch (error) {
    console.error("Auth error:", error);
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

  if (amount <= 0 || amount > 100000) {
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

  const auth = Buffer.from(
    `${consumerKey}:${consumerSecret}`
  ).toString("base64");

  const response = await axios.get(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  return response.data.access_token;
}

/* =========================
   STK PUSH
========================= */
app.post("/stkpush", validateSTKInput, async (req, res) => {
  try {
    const { phone, amount } = req.body;

    const existing = await db.collection("donations")
      .where("phone", "==", phone)
      .where("status", "==", "pending")
      .get();

    if (!existing.empty) {
      return res.status(429).json({
        error: "Pending transaction already exists"
      });
    }

    const token = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:\.Z]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      shortcode + passkey + timestamp
    ).toString("base64");

    const stkUrl =
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: "HarambeeFlow",
      TransactionDesc: "Donation",
    };

    const response = await axios.post(stkUrl, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await db.collection("donations").add({
      phone,
      amount,
      checkoutRequestID: response.data.CheckoutRequestID,
      merchantRequestID: response.data.MerchantRequestID,
      status: "pending",
      createdAt: new Date(),
    });

    res.json(response.data);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "STK Push failed" });
  }
});

/* =========================
   CALLBACK (NOW ENTERPRISE-GUARDED)
========================= */
app.post("/callback", async (req, res) => {
  try {

    // 🔐 SECRET KEY VALIDATION (ENTERPRISE LAYER)
    const secret = req.headers["x-callback-secret"];

    if (!CALLBACK_SECRET || secret !== CALLBACK_SECRET) {
      return res.status(403).json({ error: "Invalid callback secret" });
    }

    const callback = req.body.Body?.stkCallback;

    if (!callback?.CheckoutRequestID) {
      return res.status(400).json({ error: "Invalid callback" });
    }

    const status = callback.ResultCode === 0 ? "completed" : "failed";

    const snapshot = await db
      .collection("donations")
      .where("checkoutRequestID", "==", callback.CheckoutRequestID)
      .get();

    if (!snapshot.empty) {
      await snapshot.docs[0].ref.update({
        status,
        callbackData: callback,
        updatedAt: new Date(),
      });
    }

    res.json({ ResultCode: 0 });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Callback failed" });
  }
});

/* =========================
   STATS (ADMIN ONLY)
========================= */
app.get("/stats", verifyAdmin, async (req, res) => {
  try {

    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admins only" });
    }

    await logAction(req.user, "VIEW_STATS");

    const snapshot = await db.collection("donations").get();

    let total = 0;
    let completed = 0;
    let pending = 0;
    let failed = 0;

    const donations = [];

    snapshot.forEach(doc => {
      const data = doc.data();

      total += Number(data.amount || 0);

      if (data.status === "completed") completed++;
      else if (data.status === "pending") pending++;
      else if (data.status === "failed") failed++;

      donations.push({ id: doc.id, ...data });
    });

    res.json({ total, completed, pending, failed, donations });

  } catch (error) {
    res.status(500).json({ error: "Stats error" });
  }
});

/* =========================
   DONATIONS (ADMIN + FINANCE)
========================= */
app.get("/donations", verifyAdmin, async (req, res) => {
  try {

    if (!["admin", "finance"].includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed" });
    }

    await logAction(req.user, "VIEW_DONATIONS");

    const snapshot = await db.collection("donations").get();

    const donations = [];

    snapshot.forEach(doc => {
      donations.push({ id: doc.id, ...doc.data() });
    });

    res.json(donations);

  } catch (error) {
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
