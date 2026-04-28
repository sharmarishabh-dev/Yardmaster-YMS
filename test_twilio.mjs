import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function main() {
  const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
  const TWILIO_VERIFIED_TO_NUMBER = process.env.TWILIO_VERIFIED_TO_NUMBER;

  console.log({
    ACCOUNT_SID: ACCOUNT_SID ? "Found" : "Missing",
    AUTH_TOKEN: AUTH_TOKEN ? "Found" : "Missing",
    FROM: TWILIO_FROM_NUMBER,
    TO: TWILIO_VERIFIED_TO_NUMBER
  });

  const body = "[TEST] This is a test from YardMaster to debug Twilio!";

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: TWILIO_VERIFIED_TO_NUMBER,
          From: TWILIO_FROM_NUMBER,
          Body: body,
        }),
      }
    );

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Twilio send failed", res.status, payload);
    } else {
      console.log("Success!", payload);
    }
  } catch (err) {
    console.error("Error", err);
  }
}

main();
