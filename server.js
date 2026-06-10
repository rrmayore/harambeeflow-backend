```javascript
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
app.use(express.json());
app.use(cors());

// =========================
// SAFETY CHECK (PREVENT CRASH)
// =========================
if (!process.env.FIREBASE_PROJECT_ID) {
  console.error("❌ Missing FIREBASE_PROJECT_ID");
}

if (!process.env.FIREBASE_CLIENT_EMAIL) {
  console.error("❌ Missing FIREBASE_CLIENT_EMAIL");
}

if (!process.env.FIREBASE_PRIVATE_KEY) {
  console.error("❌ Missing FIREBASE_PRIVATE_KEY");
}

// =========================
// FIREBASE INIT (SAFE)
// =========================
let db;

try {
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  db = admin.firestore();
  console.log("✅ Firebase initialized successfully");
} catch (err) {
  console.error("❌ Firebase initialization failed:", err.message);
}

// =========================
// DARAJA CONFIG
// =========================
const consumerKey = process.env.CONSUMER_KEY;
const consumerSecret = process.env.CONSUMER_SECRET;
const shortcode = process.env.BUSINESS_SHORT_CODE;
const passkey = process.env.PASSKEY;
const callbackUrl = process.env.CALLBACK_URL;

// =========================
// ACCESS TOKEN
// =========================
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

    // Save to Firestore ONLY if db exists
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
  } catch (error) {
    console.error("STK ERROR:", error.response?.data || error.message);

    return res.status(500).json({
      error: "STK Push failed",
      details: error.response?.data || error.message,
    });
  }
});

// =========================
// CALLBACK
// =========================
app.post("/callback", async (req, res) => {
  try {
    console.log("CALLBACK RECEIVED:", JSON.stringify(req.body, null, 2));

    if (!db) {
      return res.json({ ResultCode: 0, ResultDesc: "No DB connection" });
    }

    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      return res.json({ ResultCode: 0, ResultDesc: "Invalid callback" });
    }

    const checkoutRequestID = callback.CheckoutRequestID;
    const resultCode = callback.ResultCode;

    let status = resultCode === 0 ? "completed" : "failed";

    const snapshot = await db
      .collection("donations")
      .where("checkoutRequestID", "==", checkoutRequestID)
      .get();

    if (!snapshot.empty) {
      const doc = snapshot.docs[0];

      await doc.ref.update({
        status,
        callbackData: callback,
        updatedAt: new Date(),
      });

      console.log("✅ Donation updated");
    }

    res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("CALLBACK ERROR:", error.message);

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
```


