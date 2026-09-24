/** Copy-paste integration snippets for the per-client metrics webhook. Pure string builders. */

export function webhookSnippets(url: string, secret: string) {
  const sampleBody = `{"metric":"leads","value":42,"unit":"leads","timestamp":"2026-09-01T00:00:00Z","idempotency_key":"crm-export-2026-09-01"}`;
  const curl = `BODY='${sampleBody}'
TS=$(date +%s)
SIG="sha256=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac '${secret}' | sed 's/^.* //')"
curl -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -H "X-ClientWrap-Timestamp: $TS" \\
  -H "X-ClientWrap-Signature: $SIG" \\
  -d "$BODY"`;

  const n8n = JSON.stringify(
    {
      name: "Send metric to ClientWrap",
      nodes: [
        { parameters: {}, name: "Start", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: [200, 300] },
        {
          parameters: {
            jsCode:
              "// Map your data here. One item = one metric.\nconst body = JSON.stringify({ metric: 'leads', value: 42, unit: 'leads', timestamp: new Date().toISOString(), idempotency_key: $execution.id + '-leads' });\nconst ts = Math.floor(Date.now() / 1000).toString();\nreturn [{ json: { body, ts, toSign: ts + '.' + body } }];",
          },
          name: "Build payload",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          position: [420, 300],
        },
        {
          parameters: { action: "hmac", type: "SHA256", value: "={{$json.toSign}}", dataPropertyName: "signature", secret, encoding: "hex" },
          name: "Sign",
          type: "n8n-nodes-base.crypto",
          typeVersion: 1,
          position: [640, 300],
        },
        {
          parameters: {
            method: "POST",
            url,
            sendHeaders: true,
            headerParameters: {
              parameters: [
                { name: "Content-Type", value: "application/json" },
                { name: "X-ClientWrap-Timestamp", value: "={{$json.ts}}" },
                { name: "X-ClientWrap-Signature", value: "=sha256={{$json.signature}}" },
              ],
            },
            sendBody: true,
            contentType: "raw",
            rawContentType: "application/json",
            body: "={{$json.body}}",
          },
          name: "POST to ClientWrap",
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4.2,
          position: [860, 300],
        },
      ],
      connections: {
        Start: { main: [[{ node: "Build payload", type: "main", index: 0 }]] },
        "Build payload": { main: [[{ node: "Sign", type: "main", index: 0 }]] },
        Sign: { main: [[{ node: "POST to ClientWrap", type: "main", index: 0 }]] },
      },
    },
    null,
    2,
  );

  const make = `Scenario: [your trigger] → Tools › Set multiple variables → HTTP › Make a request

1) Tools › Set multiple variables
   body = {"metric":"leads","value":{{1.value}},"unit":"leads","timestamp":"{{formatDate(now; "YYYY-MM-DDTHH:mm:ssZ")}}","idempotency_key":"{{1.id}}"}
   ts   = {{formatDate(now; "X")}}

2) HTTP › Make a request
   URL:      ${url}
   Method:   POST
   Headers:
     Content-Type            application/json
     X-ClientWrap-Timestamp  {{2.ts}}
     X-ClientWrap-Signature  sha256={{sha256(2.ts + "." + 2.body; "hex"; "${secret}")}}
   Body type: Raw · Content type: JSON (application/json)
   Request content: {{2.body}}

Tip: map the body from the variable (not a JSON module) so the signed text and the sent text are identical.`;

  const zapier = `// Zapier: add a "Code by Zapier" → "Run JavaScript" step.
// Input Data: metric, value, unit, timestamp (optional), id (optional, for idempotency)
const crypto = require('crypto');
const body = JSON.stringify({
  metric: inputData.metric,
  value: Number(inputData.value),
  unit: inputData.unit || '',
  timestamp: inputData.timestamp || new Date().toISOString(),
  idempotency_key: inputData.id || undefined,
});
const ts = Math.floor(Date.now() / 1000).toString();
const sig = 'sha256=' + crypto.createHmac('sha256', '${secret}').update(ts + '.' + body).digest('hex');
const res = await fetch('${url}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-ClientWrap-Timestamp': ts, 'X-ClientWrap-Signature': sig },
  body,
});
output = { status: res.status, result: await res.json() };`;

  const bearer = `# For tools that cannot compute an HMAC, send the secret as a bearer token (HTTPS only):
curl -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${secret}' \\
  -H 'Idempotency-Key: crm-export-2026-09-01' \\
  -d '{"metric":"leads","value":42,"unit":"leads"}'`;

  return { curl, n8n, make, zapier, bearer };
}
