import axios from "axios";
import { serverConfig } from "@/server/config";
import { generateOtp } from "@/lib/otp-code";

const client = axios.create({ baseURL: "https://api.ng.termii.com/api", maxRedirects: 0 });

export async function sendOtp(phone: string): Promise<string> {
  const otp = generateOtp();
  await client.post("/sms/send", {
    to: phone,
    from: serverConfig.termii.senderId,
    sms: `Your STELLAR verification code is: ${otp}. Valid for 10 minutes.`,
    type: "plain",
    channel: "generic",
    api_key: serverConfig.termii.apiKey,
  });
  return otp;
}
