const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// =========================
// HOME ROUTE
// =========================
app.get("/", (req, res) => {
  res.send("HarambeeFlow Backend Running 🚀");
});

// =========================
// GET ACCESS TOKEN
// =========================
const getAccessToken = async () => {
  try {
    const consumerKey = process.env.CONSUMER_KEY;
    const consumerSecret = process.env.CONSUMER_SECRET;

    const auth = Buffer.from(
      `${consumerKey}:${consumerSecret}`
    ).toString("base64");

    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    return response.data.access_token;

  } catch (error) {
    console.error(
      "ACCESS TOKEN ERROR:",
      error.response?.data || error.message
    );

    throw new Error("Access token generation failed");
  }
};

// =========================
// STK PUSH ROUTE
// =========================
app.post("/stkpush", async (req, res) => {
  try {

    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({
        error: "Phone and amount are required"
      });
    }

    const shortcode =
      process.env.BUSINESS_SHORT_CODE || "174379";

    const callbackURL =
      process.env.CALLBACK_URL;

    const token = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    // SANDBOX SAFE PASSWORD
    const password = Buffer.from(
      shortcode + timestamp
    ).toString("base64");

    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackURL,
      AccountReference: "HarambeeFlow",
      TransactionDesc: "Fundraiser Payment"
    };

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    return res.json(response.data);

  } catch (error) {

    console.error(
      "STK PUSH ERROR:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      error: "STK Push failed",
      details: error.response?.data || error.message
    });
  }
});

// =========================
// CALLBACK
// =========================
app.post("/callback", (req, res) => {

  console.log(
    "CALLBACK RECEIVED:",
    JSON.stringify(req.body, null, 2)
  );

  return res.json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
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
