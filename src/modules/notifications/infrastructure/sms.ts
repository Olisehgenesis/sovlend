// Thin wrapper around the Yoola SMS REST API (https://yoolasms.com/api-integration).
// Never throws for delivery failures - callers decide how to record/report them.
export type SendSmsResult = Readonly<{ ok: boolean; messageId?: string; error?: string }>;

const YOOLA_BASE_URL = "https://yoolasms.com/api/v1";

export async function sendSms(phone: string, message: string): Promise<SendSmsResult> {
  const apiKey = process.env.YOOLA_SMS_API_KEY;
  if (!apiKey) return { ok: false, error: "YOOLA_SMS_API_KEY is not configured" };

  try {
    const response = await fetch(`${YOOLA_BASE_URL}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        sender: process.env.YOOLA_SMS_SENDER_ID || undefined,
        mobiles: phone,
        message,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.status === "error") {
      return { ok: false, error: typeof body?.message === "string" ? body.message : `SMS provider returned ${response.status}` };
    }
    return { ok: true, messageId: body?.message_id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown SMS delivery error" };
  }
}
