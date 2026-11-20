// Speech-to-text (blueprint §6.4, D9). WeChat voice arrives as AMR/SILK → convert to WAV with ffmpeg first.
// mock: the simulator sends the transcript along with the voice item, or we return a placeholder.
import "server-only";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { provider, logCall } from "./llm";

export async function transcribe(filePath: string, hint?: string): Promise<{ text: string; source: string }> {
  if (provider === "mock" || !process.env.ELEVENLABS_API_KEY) {
    return { text: hint ?? "(voice note — transcription needs ELEVENLABS_API_KEY)", source: "mock" };
  }
  const t0 = Date.now();
  try {
    const wav = /\.(amr|silk|slk)$/i.test(filePath) ? await toWav(filePath) : filePath;
    const form = new FormData();
    form.append("model_id", process.env.MODEL_ASR ?? "scribe_v2");
    form.append("file", new Blob([fs.readFileSync(wav)]), "voice.wav");
    // [VERIFY] §17.11: whether the hackathon gateway proxies ElevenLabs; default is the direct API.
    const res = await fetch(process.env.ELEVENLABS_STT_URL ?? "https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`ASR ${res.status}`);
    const json = (await res.json()) as { text?: string };
    logCall({ step: "asr", model: process.env.MODEL_ASR ?? "scribe_v2", source: "live", ms: Date.now() - t0 });
    return { text: json.text ?? "", source: "live" };
  } catch (e) {
    console.error("[asr] failed:", e);
    return { text: hint ?? "(voice note could not be transcribed)", source: "fallback" };
  }
}

function toWav(input: string): Promise<string> {
  const out = input.replace(/\.[^.]+$/, ".wav");
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-y", "-i", input, "-ar", "16000", "-ac", "1", out]);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`ffmpeg exited ${code}`))));
  });
}
