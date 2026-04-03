import { GoogleGenAI, Modality } from "@google/genai";

export interface VoiceConfig {
  voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' | 'Isabella' | 'Gianni' | 'Diego' | 'Zeus';
  speed: number;
  pitch: number;
  emotion: string;
}

export async function generateSpeech(text: string, config: VoiceConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.speechSynthesis) {
      reject(new Error("Web Speech API non supportata."));
      return;
    }

    window.speechSynthesis.cancel();

    // Humanize text: Add slightly longer pauses after periods and commas
    const processedText = text
       .replace(/([.?!])\s*/g, "$1   ") // More space for periods
       .replace(/([,;:])\s*/g, "$1  ") // Some space for commas
       .replace(/<[^>]*>?/gm, ''); // Remove SSML

    const utterance = new SpeechSynthesisUtterance(processedText);
    
    const voices = window.speechSynthesis.getVoices();
    
    // Improved Mapping for Premium/Neural Voices
    const voiceMapping: Record<string, string[]> = {
      'Kore': ['Elsa', 'Google italiano', 'it-IT-Wavenet-A'],
      'Isabella': ['Isabella', 'Natural', 'it-IT-Neural'],
      'Gianni': ['Gianni', 'Google italiano', 'it-IT-Wavenet-B'],
      'Diego': ['Diego', 'Cosmo', 'it-IT-Wavenet-C'],
      'Zeus': ['Gianni', 'Google italiano', 'it-IT-Wavenet-D', 'Male', 'Man', 'Microsoft David'],
      'Puck': ['Puck', 'it-IT-Wavenet-D'],
      'Zephyr': ['Zephyr', 'it-IT-Standard-A']
    };

    const searchTerms = voiceMapping[config.voiceName] || [config.voiceName];
    let selectedVoice = voices.find(v => v.lang.startsWith('it') && searchTerms.some(term => v.name.includes(term)));

    if (!selectedVoice) {
      selectedVoice = voices.find(v => v.lang.startsWith('it') && (v.name.includes('Natural') || v.name.includes('Google'))) || 
                      voices.find(v => v.lang.startsWith('it')) || 
                      voices[0];
    }

    if (selectedVoice) utterance.voice = selectedVoice;
    
    // Human Tuning
    let finalRate = (config.speed || 1.0) * 0.95;
    let finalPitch = (config.pitch || 1.0);

    // VOICE-SPECIFIC TUNING
    if (config.voiceName === 'Zeus') {
      finalPitch *= 0.8; // Veramente cupo
      finalRate *= 0.85;  // Più lento e solenne
    }
    
    utterance.rate = finalRate;
    utterance.pitch = finalPitch;
    
    // Subtle pitch variation based on emotion placeholder
    if (config.emotion.includes('allegra')) utterance.pitch *= 1.05;
    if (config.emotion.includes('triste')) utterance.pitch *= 0.95;
    if (config.emotion.includes('misteriosa')) utterance.rate *= 0.85;

    utterance.lang = 'it-IT';
    utterance.volume = 1;

    utterance.onend = () => resolve("done");
    utterance.onerror = (e) => reject(e);

    window.speechSynthesis.speak(utterance);
    resolve("speech_started"); 
  });
}

