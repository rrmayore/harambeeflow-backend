const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();

app.use(express.json());
app.use(cors());

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
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

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
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // SAVE DONATION (PENDING)
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

    res.status(500).json({
      error: "STK Push failed",
      details: error.response?.data || error.message,
    });
  }
});

/* =========================
   CALLBACK (SAFE + FIXED)
========================= */
app.post("/callback", async (req, res) => {
  try {
    console.log("🔥 CALLBACK RECEIVED:");
    console.log(JSON.stringify(req.body, null, 2));

    const callback = req.body.Body?.stkCallback;

    if (!callback) {
      return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
    }

    const checkoutRequestID = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    let status = resultCode === 0 ? "completed" : "failed";

    const snapshot = await db
      .collection("donations")
      .where("checkoutRequestID", "==", checkoutRequestID)
      .get();

    if (!snapshot.empty) {
      await snapshot.docs[0].ref.update({
        status,
        callbackData: callback,
        updatedAt: new Date(),
      });

      console.log("✅ Donation updated");
    } else {
      console.log("⚠️ Donation not found");
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });

  } catch (error) {
    console.error("Callback error:", error);
    res.status(500).json({ error: "Callback failed" });
  }
});

/* =========================
   GET ALL DONATIONS (DASHBOARD)
========================= */
app.get("/donations", async (req, res) => {
  try {
    const snapshot = await db.collection("donations").get();

    const donations = [];

    snapshot.forEach(doc => {
      donations.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    res.json(donations);

  } catch (error) {
    res.status(500).json({ error: "Failed to fetch donations" });
  }
});

/* =========================
   STATS API (DASHBOARD PRO)
========================= */
app.get("/stats", async (req, res) => {
  try {
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

    res.json({
      total,
      completed,
      pending,
      failed,
      donations,
    });

  } catch (error) {
    res.status(500).json({ error: "Failed to load stats" });
  }
});

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("HarambeeFlow Backend Running 🚀");
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
