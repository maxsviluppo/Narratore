export interface MediaItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  duration: number; // in seconds
  uploading?: boolean;
}

export interface StoryPage {
  id: string;
  text: string;
  media: MediaItem[];
}

export interface Story {
  id: string;
  title: string;
  pages: StoryPage[];
  createdAt: number;
  uid?: string;
  voiceConfig: {
    voiceName: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr' | 'Isabella' | 'Gianni' | 'Diego' | 'Zeus';
    speed: number;
    pitch: number;
    emotion: string;
  };
}

export interface StoryPrompt {
  id: string;
  uid: string;
  theme: string;
  keywords: string[];
  promptText: string;
  createdAt: number;
}

export const DEFAULT_VOICE_CONFIG: Story['voiceConfig'] = {
  voiceName: 'Kore',
  speed: 1.0,
  pitch: 1.0,
  emotion: 'calma e rassicurante'
};

export const MOCK_STORIES: Story[] = [
  {
    id: '1',
    title: 'La Scogliera',
    pages: [
      {
        id: 'p1',
        text: 'Il vento soffiava dal mare con un odore di sale, avventura e pesce fritto. Guybrush Threepwood guardava l\'orizzonte con occhi pieni di sogni — e un gabbiano che sembrava non condividere l\'entusiasmo.',
        media: [{ id: 'm1', url: 'https://picsum.photos/seed/cliff/1200/800', type: 'image', duration: 5 }]
      },
      {
        id: 'p2',
        text: 'La luna piena illuminava il sentiero verso il porto. Le luci della città brillavano in lontananza, promettendo nuove avventure e forse un boccale di grog.',
        media: [{ id: 'm1', url: 'https://picsum.photos/seed/harbor/1200/800', type: 'image', duration: 5 }]
      }
    ],
    createdAt: Date.now(),
    voiceConfig: {
      voiceName: 'Kore',
      emotion: 'dolce e rassicurante',
      speed: 0.9,
      pitch: 1.0
    }
  },
  {
    id: '2',
    title: 'Il Castello delle Ombre',
    pages: [
      {
        id: 'p1',
        text: 'Le mura del castello sussurravano segreti dimenticati. <break time="1s"/> Un\'ombra si allungava lungo il corridoio, portando con sé il gelo di mille inverni.',
        media: [{ id: 'm1', url: 'https://picsum.photos/seed/castle/1200/800', type: 'image', duration: 5 }]
      }
    ],
    createdAt: Date.now() - 10000,
    voiceConfig: {
      voiceName: 'Fenrir',
      emotion: 'profonda, cupa e molto misteriosa',
      speed: 0.8,
      pitch: 0.9
    }
  }
];
