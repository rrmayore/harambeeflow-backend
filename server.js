
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors());

console.log("🚀 Starting HarambeeFlow backend...");

// =========================
// ENV CHECK (NO CRASH)
// =========================
const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  CONSUMER_KEY,
  CONSUMER_SECRET,
  BUSINESS_SHORT_CODE,
  PASSKEY,
  CALLBACK_URL,
} = process.env;

// =========================
// FIREBASE INIT (SAFE MODE)
// =========================
let db = null;

try {
  if (
    FIREBASE_PROJECT_ID &&
    FIREBASE_CLIENT_EMAIL &&
    FIREBASE_PRIVATE_KEY
  ) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });

    db = admin.firestore();

    console.log("✅ Firebase connected");
  } else {
    console.log("⚠️ Firebase env missing - running without Firestore");
  }
} catch (err) {
  console.error("❌ Firebase init error:", err.message);
}

// =========================
// ACCESS TOKEN
// =========================
async function getAccessToken() {
  const url =
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const auth = Buffer.from(
    `${CONSUMER_KEY}:${CONSUMER_SECRET}`
  ).toString("base64");

  const response = await axios.get(url, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  return response.data.access_token;
}

// =========================
// STK PUSH
// =========================
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    const token = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[-T:\.Z]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      BUSINESS_SHORT_CODE + PASSKEY + timestamp
    ).toString("base64");

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: BUSINESS_SHORT_CODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: BUSINESS_SHORT_CODE,
        PhoneNumber: phone,
        CallBackURL: CALLBACK_URL,
        AccountReference: "HarambeeFlow",
        TransactionDesc: "Donation",
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    // Save ONLY if Firebase is available
    if (db) {
      await db.collection("donations").add({
        phone,
        amount,
        checkoutRequestID: response.data.CheckoutRequestID,
        merchantRequestID: response.data.MerchantRequestID,
        status: "pending",
        createdAt: new Date(),
      });
    }

    return res.json(response.data);
  } catch (err) {
    console.error("STK ERROR:", err.response?.data || err.message);

    return res.status(500).json({
      error: "STK Push failed",
      details: err.response?.data || err.message,
    });
  }
});

// =========================
// CALLBACK
// =========================
app.post("/callback", async (req, res) => {
  try {
    console.log("CALLBACK:", JSON.stringify(req.body, null, 2));

    const callback = req.body?.Body?.stkCallback;

    if (db && callback) {
      const checkoutRequestID = callback.CheckoutRequestID;
      const status = callback.ResultCode === 0 ? "completed" : "failed";

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
      }
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    console.error("CALLBACK ERROR:", err.message);
    res.status(500).json({ error: "Callback failed" });
  }
});

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("HarambeeFlow Backend Running 🚀");
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
