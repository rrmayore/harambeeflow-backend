```javascript
const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// ===============================
// HOME ROUTE
// ===============================
app.get("/", (req, res) => {
  res.send("HarambeeFlow Backend Running 🚀");
});

// ===============================
// ACCESS TOKEN FUNCTION
// ===============================
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

    throw new Error("Failed to generate access token");
  }
};

// ===============================
// STK PUSH ROUTE
// ===============================
app.post("/stkpush", async (req, res) => {

  try {

    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({
        error: "Phone and amount are required"
      });
    }

    const shortcode =
      process.env.BUSINESS_SHORT_CODE;

    const passkey =
      process.env.PASSKEY;

    const callbackURL =
      process.env.CALLBACK_URL;

    // Timestamp format
    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    // Password generation
    const password = Buffer.from(
      shortcode + passkey + timestamp
    ).toString("base64");

    // Get access token
    const token = await getAccessToken();

    // STK payload
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
      TransactionDesc: "Fundraiser Contribution"
    };

    // Send STK request
    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    console.log("STK SUCCESS:", response.data);

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

// ===============================
// CALLBACK ROUTE
// ===============================
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

// ===============================
// START SERVER
// ===============================
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

