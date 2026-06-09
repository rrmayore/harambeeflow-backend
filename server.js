const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// 1. GET ACCESS TOKEN
// =========================
const getAccessToken = async () => {
  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString("base64");

  const response = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  );

  return response.data.access_token;
};

// =========================
// 2. STK PUSH ENDPOINT
// =========================
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    const token = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      process.env.BUSINESS_SHORT_CODE +
        process.env.PASSKEY +
        timestamp
    ).toString("base64");

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      {
        BusinessShortCode: process.env.BUSINESS_SHORT_CODE,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.BUSINESS_SHORT_CODE,
        PhoneNumber: phone,
        CallBackURL: process.env.CALLBACK_URL,
        AccountReference: "HarambeeFlow",
        TransactionDesc: "Fundraiser Contribution"
      },
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: "STK Push failed" });
  }
});

// =========================
// 3. CALLBACK URL
// =========================
app.post("/callback", (req, res) => {
  console.log("M-PESA CALLBACK RECEIVED:");
  console.log(JSON.stringify(req.body, null, 2));

  res.json({ ResultCode: 0, ResultDesc: "Success" });
});

// =========================
// 4. HOME ROUTE
// =========================
app.get("/", (req, res) => {
  res.send("HarambeeFlow M-PESA Backend Running 🚀");
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
