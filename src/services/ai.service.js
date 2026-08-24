/**
 * Turns an already-flagged log entry into a plain-English explanation and a
 * likely root cause / next step, using the Gemini API. The AI never decides
 * WHAT is anomalous - that's entirely anomalyDetector.service.js. It only
 * explains entries handed to it.
 */

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

function endpoint() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
}

/**
 * @param {object} log - the flagged log row
 * @param {object} flag - { score, reasons, reasonSummary }
 * @returns {Promise<{explanation:string, rootCause:string}>}
 */
export async function explainFlaggedLog(log, flag) {
  const prompt = buildPrompt(log, flag);

  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 300,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini API returned no content");

  return parseModelOutput(text);
}

function buildPrompt(log, flag) {
  return `You are helping an on-call engineer triage a log entry that an automated anomaly detector has already flagged (you are NOT deciding whether it is anomalous, only explaining it).

Log entry:
- timestamp: ${log.timestamp}
- source: ${log.source}
- event_type: ${log.event_type}
- severity: ${log.severity}
- status_code: ${log.status_code ?? "n/a"}
- message: ${log.message ?? "n/a"}

Detector output (already decided, do not second-guess):
- anomaly score: ${flag.score}
- triggered rules: ${flag.reasons.join(", ")}
- rule summary: ${flag.reasonSummary}

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"explanation": "1-2 plain-English sentences a non-expert could understand, describing what happened and why it looked unusual", "rootCause": "1-2 sentences giving the most likely root cause and a concrete next step to investigate or resolve it"}`;
}

function parseModelOutput(text) {
  let cleaned = text.trim();
  // Defensive: strip markdown fences if the model adds them anyway
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      explanation: String(parsed.explanation ?? "").trim(),
      rootCause: String(parsed.rootCause ?? "").trim(),
    };
  } catch (err) {
    throw new Error(`Could not parse Gemini response as JSON: ${cleaned.slice(0, 200)}`);
  }
}
