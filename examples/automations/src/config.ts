// src/config.ts
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is not set`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  // Secrets for verifying incoming webhooks
  siteSecret: required("SITE_WEBHOOK_SECRET"),
  telegramSecret: required("TELEGRAM_WEBHOOK_SECRET"),
  // Bot for replies and alerts
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  telegramApi: process.env.TELEGRAM_API ?? "https://api.telegram.org",
  alertChatId: required("ALERT_CHAT_ID"),
  // Leads: the managers' chat and where the form sends people after submitting
  leadsChatId: required("LEADS_CHAT_ID"),
  formRedirectUrl: required("FORM_REDIRECT_URL"),
  // Bitrix24 incoming webhook, e.g. https://you.bitrix24.ru/rest/1/abc123/
  // Leave empty to skip the CRM.
  crmWebhookUrl: process.env.CRM_WEBHOOK_URL ?? "",
  // Payments: YooKassa shop credentials and our public address for /pay links
  yookassaShopId: required("YOOKASSA_SHOP_ID"),
  yookassaSecretKey: required("YOOKASSA_SECRET_KEY"),
  yookassaApi: process.env.YOOKASSA_API ?? "https://api.yookassa.ru/v3",
  publicUrl: required("PUBLIC_URL"),
  // Where a paid client gets access, e.g. https://example.com/access/
  accessUrl: required("ACCESS_URL"),
  // Email through Resend's HTTP API; any provider with an HTTP API works
  emailApiKey: required("EMAIL_API_KEY"),
  emailFrom: required("EMAIL_FROM"),
  emailApi: process.env.EMAIL_API ?? "https://api.resend.com",
  // Support: the agents' chat and the password in the inbound email webhook URL
  supportChatId: required("SUPPORT_CHAT_ID"),
  emailInboundSecret: required("EMAIL_INBOUND_SECRET"),
  // Analytics: where the morning digest goes
  digestChatId: required("DIGEST_CHAT_ID"),
  // Operations: the Healthchecks ping URL and an alert threshold for model spend
  heartbeatUrl: process.env.HEARTBEAT_URL ?? "",
  llmDailyLimit: Number(process.env.LLM_DAILY_LIMIT_USD ?? 5),
};
