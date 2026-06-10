const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// ======================
// HEALTH CHECK ROUTE
// ======================
app.get("/", (req, res) => {
  res.send("HarambeeFlow Backend Running 🚀");
});

// ======================
// ACCESS TOKEN
// ======================
async function getAccessToken() {
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
    console.error("TOKEN ERROR:", error.response?.data || error.message);
    throw new Error("Failed to get access token");
  }
}

// ======================
// STK PUSH ROUTE
// ======================
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({
        error: "Phone and amount required"
      });
    }

    const shortcode = process.env.BUSINESS_SHORT_CODE;
    const passkey = process.env.PASSKEY;
    const callbackURL = process.env.CALLBACK_URL;

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      shortcode + passkey + timestamp
    ).toString("base64");

    const token = await getAccessToken();

    const stkRequest = {
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
      TransactionDesc: "Donation"
    };

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkRequest,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    console.log("STK SUCCESS:", response.data);

    res.json(response.data);

  } catch (error) {
    console.error("STK ERROR:", error.response?.data || error.message);

    res.status(500).json({
      error: "STK Push failed",
      details: error.response?.data || error.message
    });
  }
});

// ======================
// CALLBACK ROUTE
// ======================
app.post("/callback", (req, res) => {
  console.log("CALLBACK RECEIVED:", JSON.stringify(req.body, null, 2));

  res.json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
});

// ======================
// START SERVER
// ======================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
