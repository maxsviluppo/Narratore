import { GoogleGenAI, Modality } from "@google/genai";

export interface VoiceConfig {
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  speed: number;
  pitch: number;
  emotion: string;
}

export async function generateSpeech(text: string, config: VoiceConfig): Promise<string> {
  // We instruct the model to act as a high-quality TTS engine that respects SSML tags
  const prompt = `
    ISTRUZIONI NARRATORE:
    - Voce: ${config.voiceName}
    - Emozione: ${config.emotion}
    - Velocità: ${config.speed}x (1.0 è normale)
    - Pitch: ${config.pitch} (1.0 è normale)
    - SUPPORTO SSML: Interpreta rigorosamente i tag SSML presenti nel testo.
      Esempi supportati:
      - <break time="1s"/> per pause.
      - <prosody rate="slow" pitch="+2st"> per velocità e tono.
      - <emphasis level="strong"> per enfasi.
      - <say-as interpret-as="date" format="dmy">02-04-2026</say-as> per date.
      - <say-as interpret-as="cardinal">12345</say-as> per numeri.
      - <phoneme alphabet="ipa" ph="təmeɪtoʊ">tomato</phoneme> per pronunce specifiche.
    
    TESTO DA LEGGERE:
    ${text}
  `;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY_MISSING: Chiave API Gemini non trovata. Controlla le impostazioni.");
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: config.voiceName },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      // The model returns raw PCM (16-bit, 24kHz). We need to wrap it in a WAV header for the <audio> tag.
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const wavHeader = createWavHeader(len, 24000, 1, 16);
      
      const wavBuffer = new Uint8Array(44 + len);
      wavBuffer.set(new Uint8Array(wavHeader), 0);
      for (let i = 0; i < len; i++) {
        wavBuffer[44 + i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([wavBuffer], { type: 'audio/wav' });
      return URL.createObjectURL(blob);
    }
    throw new Error("Nessun audio generato");
  } catch (error) {
    console.error("Errore generazione audio:", error);
    throw error;
  }
}

function createWavHeader(dataLength: number, sampleRate: number, numChannels: number, bitsPerSample: number) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataLength, true);
  view.setUint32(8, 0x57415645, false); // "WAVE"
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataLength, true);

  return header;
}
