/**
 * Visual-Agent — automatisierte Entsprechung von Lukes "Phase 3: Visuals + Motion".
 * "The hero image is half the site."
 *
 * Strategie (Entscheidung Jan 2026-06-10: Hybrid + Video-Loops als Premium-Stufe):
 *   1. Video-Loop  — wenn Kling-Keys gesetzt UND Video angefordert (Premium, kostet Credits)
 *   2. Echtes Foto — bestes gescraptes Foto, veredelt mit Ken-Burns/Parallax (kostenlos, authentisch)
 *   3. AI-Bild     — generiert über Gemini Image API, wenn GEMINI_API_KEY gesetzt
 *   4. Gradient    — animierter Premium-Gradient als letzter Fallback (nie generisch lila)
 *
 * Jede Stufe fällt bei Fehlern sauber auf die nächste zurück — die Pipeline bricht nie
 * wegen eines Visuals ab.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const KLING_BASE = process.env.KLING_API_BASE || 'https://api-singapore.klingai.com';

/**
 * Haupteinstieg: liefert den Hero-Visual-Deskriptor für den Generator.
 * @param {object} project  Projekt mit photos[], name, description, …
 * @param {string} projectDir  Ordner des Projekts (assets/ liegt darin)
 * @param {object} opts  { video: boolean }  Video-Loop als Premium-Stufe anfordern
 */
async function prepareHeroVisual(project, projectDir, opts = {}) {
  const dna = opts.dna || null;

  // ── Stufe 2 vorbereiten: bestes Foto bestimmen (brauchen wir auch als Kling-Input) ──
  const heroPhoto = pickHeroPhoto(project.photos || []);

  // ── Stufe 1: Video-Loop (Premium) ──────────────────────────────────────────
  if (opts.video && process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY) {
    try {
      const sourceImage = heroPhoto || await generateHeroImage(project, projectDir, dna);
      if (sourceImage) {
        const videoPath = await generateHeroVideoLoop(sourceImage, project, projectDir, dna);
        if (videoPath) {
          return {
            type: 'video', src: 'assets/hero.mp4', poster: localAssetOrUrl(sourceImage),
            motionHint: 'Video läuft als Fullscreen-Loop (autoplay, muted, loop, playsinline), Poster-Bild als Fallback.'
          };
        }
      }
    } catch (e) {
      console.warn('⚠️ Video-Loop fehlgeschlagen, falle zurück auf Foto/Bild:', e.message);
    }
  }

  // ── Stufe 2: echtes Foto ───────────────────────────────────────────────────
  if (heroPhoto) {
    return {
      type: 'photo', src: heroPhoto,
      motionHint: 'Ken-Burns auf dem Hero-Foto: langsamer Zoom von scale(1) auf scale(1.08) über 25s, alternierend. Zusätzlich sanfter Parallax beim Scrollen (Hintergrund bewegt sich langsamer als Inhalt).'
    };
  }

  // ── Stufe 3: AI-Bild ───────────────────────────────────────────────────────
  if (process.env.GEMINI_API_KEY) {
    try {
      const imgPath = await generateHeroImage(project, projectDir, dna);
      if (imgPath) {
        return {
          type: 'ai-image', src: 'assets/hero.jpg',
          motionHint: 'Ken-Burns auf dem Hero-Bild: langsamer Zoom scale(1) → scale(1.08) über 25s + sanfter Parallax beim Scrollen.'
        };
      }
    } catch (e) {
      console.warn('⚠️ AI-Bild fehlgeschlagen, falle zurück auf Gradient:', e.message);
    }
  }

  // ── Stufe 4: Premium-Gradient ──────────────────────────────────────────────
  return {
    type: 'gradient', src: null,
    motionHint: 'Animierter Premium-Gradient aus der DNA-Palette (Hintergrund + abgedunkelte Akzent-Töne, NIE lila Standard-Gradient). Sehr langsame Bewegung (20s+), dazu eine dezente, langsam treibende Licht-Fläche (radial, blur).'
  };
}

/** Bestes Foto wählen: erstes brauchbares (Scraper sortiert bereits nach Relevanz). */
function pickHeroPhoto(photos) {
  if (!Array.isArray(photos)) return null;
  return photos.find(p => typeof p === 'string' && /^https?:\/\//.test(p) && !/logo|icon|favicon/i.test(p)) || null;
}

function localAssetOrUrl(src) {
  return src && src.startsWith('http') ? src : 'assets/hero.jpg';
}

// ── Stufe 3: Gemini Image API ─────────────────────────────────────────────────

/**
 * Hero-Bild generieren. Der Prompt folgt Lukes Struktur:
 * Subject · Lighting · Mood · Composition · Aspect Ratio · Style Cues.
 */
async function generateHeroImage(project, projectDir, dna) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = buildImagePrompt(project, dna);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

  const res = await axios.post(url, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9' } }
  }, {
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    timeout: 120000
  });

  const parts = res.data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.data);
  if (!imgPart) throw new Error('Gemini hat kein Bild zurückgegeben');

  const outPath = path.join(projectDir, 'assets', 'hero.jpg');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(imgPart.inlineData.data, 'base64'));
  console.log(`🖼️ AI-Hero-Bild generiert: ${outPath}`);
  return outPath;
}

/** Bild-Prompt nach Lukes Schema (Subject, Lighting, Mood, Composition, Ratio, Style). */
function buildImagePrompt(project, dna) {
  const mood = dna?.vibe || 'einladend, professionell';
  const dark = dna?.mode === 'dark';
  return `Cinematic hero image for the website of "${project.name}" (${project.category || 'local business'}, ${project.cuisine || project.description || ''}).
Subject: the essence of this business — atmosphere, craft, signature product. No people looking at camera, no text, no logos.
Lighting: ${dark ? 'low-key, warm practical lights, deep shadows' : 'soft natural daylight, gentle highlights'}.
Mood: ${mood}.
Composition: wide 16:9, clear focal subject off-center (rule of thirds), generous negative space for a headline, shallow depth of field.
Style: editorial photography, cinematic film still, photorealistic, high-end magazine quality. Aspect ratio 16:9.`;
}

// ── Stufe 1: Kling Image-to-Video ─────────────────────────────────────────────

/** JWT für Kling (HS256, ak/sk) — ohne externe Library. */
function klingJwt() {
  const ak = process.env.KLING_ACCESS_KEY;
  const sk = process.env.KLING_SECRET_KEY;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', sk).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/**
 * 5s-Hero-Loop via Kling Image-to-Video. Lukes Regeln: EINE Bewegung,
 * 5 Sekunden, Loop explizit, Kamerabewegung in einfachen Worten.
 */
async function generateHeroVideoLoop(sourceImage, project, projectDir, dna) {
  const headers = { Authorization: `Bearer ${klingJwt()}`, 'Content-Type': 'application/json' };

  let imagePayload;
  if (sourceImage.startsWith('http')) {
    imagePayload = sourceImage;
  } else {
    imagePayload = fs.readFileSync(sourceImage).toString('base64');
  }

  const motionPrompt = `Slow cinematic camera push-in, very subtle. Atmosphere gently alive (${dna?.mode === 'dark' ? 'soft light flicker, faint drifting haze' : 'soft daylight shift, gentle ambient movement'}). One motion only. Seamless loop.`;

  const createRes = await axios.post(`${KLING_BASE}/v1/videos/image2video`, {
    model_name: process.env.KLING_MODEL || 'kling-v1-6',
    image: imagePayload,
    prompt: motionPrompt,
    mode: 'std',
    duration: '5',
    cfg_scale: 0.5
  }, { headers, timeout: 60000 });

  const taskId = createRes.data?.data?.task_id;
  if (!taskId) throw new Error('Kling-Task konnte nicht erstellt werden: ' + JSON.stringify(createRes.data));
  console.log(`🎬 Kling-Video-Task gestartet: ${taskId} (dauert einige Minuten)`);

  // Polling: bis zu 10 Minuten, alle 15s
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 15000));
    const poll = await axios.get(`${KLING_BASE}/v1/videos/image2video/${taskId}`, {
      headers: { Authorization: `Bearer ${klingJwt()}` }, timeout: 30000
    });
    const task = poll.data?.data;
    if (task?.task_status === 'succeed') {
      const videoUrl = task?.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error('Kling: kein Video-URL im Ergebnis');
      const outPath = path.join(projectDir, 'assets', 'hero.mp4');
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const video = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
      fs.writeFileSync(outPath, video.data);
      console.log(`🎬 Hero-Video-Loop gespeichert: ${outPath}`);
      return outPath;
    }
    if (task?.task_status === 'failed') {
      throw new Error('Kling-Task fehlgeschlagen: ' + (task?.task_status_msg || 'unbekannt'));
    }
  }
  throw new Error('Kling-Task Timeout nach 10 Minuten');
}

module.exports = { prepareHeroVisual };
