/** Strips secrets from log text. Applied to every line before it reaches the console or the log file. */
const RULES: [RegExp, string][] = [
  [/(authorization\s*[:=]\s*)(bearer|basic|sapisidhash|sapisid1phash|sapisid3phash)?\s*[^\s,;"'}]+/gi, '$1[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer [redacted]'],
  [/\bSAPISID(?:1P|3P)?HASH\s+[^\s,;"']+/g, 'SAPISIDHASH [redacted]'],
  [/((?:^|[\s"'{,;])(?:__Secure-[0-9A-Z]*)?(?:SAPISID|APISID|SSID|HSID|SID|LOGIN_INFO|PSIDTS|PSIDCC|PSID|VISITOR_INFO1_LIVE|VISITOR_PRIVACY_METADATA|YSC)\s*=)[^\s;,"']+/g, '$1[redacted]'],
  [/((?:set-)?cookie\s*[:=]\s*)[^\n]+/gi, '$1[redacted]'],
  [/(["']?(?:token|access_token|refresh_token|api[_-]?key|password|secret|po_?token|visitorData|visitor_data)["']?\s*[:=]\s*["']?)[^\s,;"'}&]+/gi, '$1[redacted]'],
  [/([?&](?:token|key|sig|signature|pot|n)=)[^&\s"']+/gi, '$1[redacted]'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
