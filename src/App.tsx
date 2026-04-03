import React, { useState, useEffect, useRef, Component } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { get, set } from 'idb-keyval';
import { 
  Book, 
  Plus, 
  Play, 
  Settings, 
  Trash2, 
  ChevronLeft, 
  Volume2, 
  Sparkles,
  Save,
  Music,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Video,
  Wand2,
  Image as ImageIcon,
  X,
  Download,
  FileText,
  Headphones,
  BookOpen,
  Loader2,
  LogOut,
  LogIn,
  User as UserIcon
} from 'lucide-react';
import { generateSpeech } from './lib/tts';
import { GoogleGenAI, Modality } from "@google/genai";
import { Story, StoryPage, MOCK_STORIES, StoryPrompt, DEFAULT_VOICE_CONFIG } from './types';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import ReactMarkdown from 'react-markdown';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { collection, query, where, onSnapshot, doc, setDoc, deleteDoc, getDocFromServer, getDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const Tooltip = ({ children, text }: { children: React.ReactNode; text: string }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative flex items-center" onMouseEnter={() => setIsVisible(true)} onMouseLeave={() => setIsVisible(false)}>
      {children}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-stone-800 text-white text-xs font-medium rounded-lg shadow-xl whitespace-nowrap z-[100] pointer-events-none"
          >
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-stone-800" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const LivePreview = ({ page, storyTitle, pageNumber, totalPages }: { page: StoryPage; storyTitle: string; pageNumber: number; totalPages: number }) => {
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);

  useEffect(() => {
    if (page.media.length === 0) return;
    const interval = setInterval(() => {
      setCurrentMediaIndex(prev => (prev + 1) % page.media.length);
    }, (page.media[currentMediaIndex]?.duration || 5) * 1000);
    return () => clearInterval(interval);
  }, [page.media, currentMediaIndex]);

  return (
    <div className="relative w-full aspect-[9/16] md:aspect-video bg-stone-900 rounded-[2rem] overflow-hidden shadow-2xl border-8 border-stone-800">
      <AnimatePresence mode="wait">
        <motion.div
          key={`${page.id}-${currentMediaIndex}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8 }}
          className="absolute inset-0"
        >
          {page.media[currentMediaIndex]?.url ? (
            <SmartMedia
              url={page.media[currentMediaIndex].url}
              type={page.media[currentMediaIndex].type}
              className="w-full h-full"
              muted
              loop
              playsInline
              autoPlay
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-stone-700">
              <ImageIcon size={64} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        <div className="max-w-2xl mx-auto">
          <h4 className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-2">
            {storyTitle} — Pagina {pageNumber} di {totalPages}
          </h4>
          <p className="text-white text-sm md:text-base font-serif leading-relaxed italic line-clamp-4">
            {page.text || "Inizia a scrivere la tua storia..."}
          </p>
        </div>
      </div>
    </div>
  );
};

const SmartMedia = ({ url, type, className, ...props }: { url: string; type: 'image' | 'video'; className?: string; [key: string]: any }) => {
  const [cachedUrl, setCachedUrl] = useState<string>(url);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!url || url.startsWith('data:')) {
      setCachedUrl(url);
      return;
    }

    const cacheName = 'media-cache-v1';
    
    const fetchAndCache = async () => {
      try {
        const cache = await caches.open(cacheName);
        const cachedResponse = await cache.match(url);

        if (cachedResponse) {
          const blob = await cachedResponse.blob();
          setCachedUrl(URL.createObjectURL(blob));
          return;
        }

        setLoading(true);
        const response = await fetch(url, { mode: 'cors' });
        if (response.ok) {
          const responseToCache = response.clone();
          await cache.put(url, responseToCache);
          const blob = await response.blob();
          setCachedUrl(URL.createObjectURL(blob));
        } else {
          setCachedUrl(url);
        }
      } catch (error) {
        console.error("Cache error:", error);
        setCachedUrl(url);
      } finally {
        setLoading(false);
      }
    };

    fetchAndCache();
  }, [url]);

  if (type === 'video') {
    return (
      <div className={`relative ${className}`}>
        {loading && <div className="absolute inset-0 flex items-center justify-center bg-stone-100/50 z-10"><Loader2 className="animate-spin text-amber-500" size={20} /></div>}
        <video src={cachedUrl} className="w-full h-full object-cover" {...props} />
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-stone-100/50 z-10"><Loader2 className="animate-spin text-amber-500" size={20} /></div>}
      <img src={cachedUrl} className="w-full h-full object-cover" referrerPolicy="no-referrer" {...props} />
    </div>
  );
};


class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 p-6">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md text-center">
            <h2 className="text-2xl font-bold text-stone-800 mb-4">Ops! Qualcosa è andato storto.</h2>
            <p className="text-stone-600 mb-6">L'applicazione ha riscontrato un errore imprevisto.</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-amber-500 text-white px-6 py-2 rounded-full font-bold hover:bg-amber-600 transition-all"
            >
              Ricarica App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [stories, setStories] = useState<Story[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [currentView, setCurrentView] = useState<'dashboard' | 'editor' | 'reader'>('dashboard');
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [readingStory, setReadingStory] = useState<Story | null>(null);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [showText, setShowText] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [exportingStory, setExportingStory] = useState<Story | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [prompts, setPrompts] = useState<StoryPrompt[]>([]);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [showPromptGenerator, setShowPromptGenerator] = useState(false);
  const [promptTheme, setPromptTheme] = useState('');
  const [promptKeywords, setPromptKeywords] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewPageIndex, setPreviewPageIndex] = useState(0);
  const [isGeneratingImage, setIsGeneratingImage] = useState<string | null>(null); // pageId
  const [aiImagePromptModal, setAiImagePromptModal] = useState<{ pageIndex: number; mediaIndex: number; prompt: string } | null>(null);
  const [securitySecret, setSecuritySecret] = useState('');
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [globalVoiceConfig, setGlobalVoiceConfig] = useState<Story['voiceConfig']>(DEFAULT_VOICE_CONFIG);
  const [showSetupModal, setShowSetupModal] = useState(false);
  
  const editingStoryRef = useRef(editingStory);

  useEffect(() => {
    editingStoryRef.current = editingStory;
  }, [editingStory]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        // Ensure user document exists in Firestore
        const userRef = doc(db, 'users', user.uid);
        try {
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: user.uid,
              email: user.email || '',
              displayName: user.displayName || '',
              photoURL: user.photoURL || '',
              role: 'user' // Default role
            });
          }
        } catch (error) {
          console.error("Error checking/creating user document:", error);
        }
      }
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  // Firestore Stories Listener
  useEffect(() => {
    if (!isAuthReady) return;
    if (!user) {
      // Load from local storage or mock if not logged in
      const loadLocal = async () => {
        try {
          const saved = await get('stories');
          if (saved) setStories(JSON.parse(saved));
          else setStories(MOCK_STORIES);
        } catch (e) {
          setStories(MOCK_STORIES);
        } finally {
          setIsLoaded(true);
        }
      };
      loadLocal();
      return;
    }

    const q = query(collection(db, 'stories'), where('uid', '==', user.uid));
    const unsubscribeStories = onSnapshot(q, (snapshot) => {
      const fetchedStories = snapshot.docs.map(doc => doc.data() as Story);
      setStories(fetchedStories.length > 0 ? fetchedStories : []);
      setIsLoaded(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'stories');
    });

    const qPrompts = query(collection(db, 'prompts'), where('uid', '==', user.uid));
    const unsubscribePrompts = onSnapshot(qPrompts, (snapshot) => {
      const fetchedPrompts = snapshot.docs.map(doc => doc.data() as StoryPrompt);
      setPrompts(fetchedPrompts.sort((a, b) => b.createdAt - a.createdAt));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'prompts');
    });

    return () => {
      unsubscribeStories();
      unsubscribePrompts();
    };
  }, [user, isAuthReady]);

  // Load/Save Global Config
  useEffect(() => {
    get('globalVoiceConfig').then(val => {
      if (val) setGlobalVoiceConfig(val);
    });
  }, []);

  const saveGlobalConfig = async (config: Story['voiceConfig']) => {
    try {
      setGlobalVoiceConfig(config);
      await set('globalVoiceConfig', config);
      setShowSetupModal(false);
    } catch (error) {
      console.error("Failed to save global config:", error);
    }
  };

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Force account selection to avoid auto-login loops if there's an error
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      console.log("Login successful:", result.user.email);
    } catch (error: any) {
      console.error("Login failed detailed:", error);
      if (error.code === 'auth/unauthorized-domain') {
        alert(`ERRORE ACCESSO: Il dominio "${window.location.hostname}" non è autorizzato. Vai nella Console Firebase > Authentication > Settings > Authorized Domains e aggiungilo.`);
      } else if (error.code === 'auth/popup-blocked') {
        alert("ERRORE ACCESSO: Il browser ha bloccato il popup di accesso. Abilita i popup per questo sito.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        // User closed the popup, ignore
      } else {
        alert("ERRORE ACCESSO (" + error.code + "): " + error.message);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentView('dashboard');
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleSecretLogoutAll = async () => {
    // SECURITY MASTER LOGOUT: Requires secret "Narratore2026"
    if (securitySecret !== 'Narratore2026') {
        alert("Codice Segreto Errato!");
        return;
    }
    
    try {
        await signOut(auth);
        localStorage.clear();
        sessionStorage.clear();
        const { clear } = await import('idb-keyval');
        await clear();
        alert("Sistema resettato e sessioni chiuse correttamente.");
        window.location.reload();
    } catch (error) {
        console.error("Master logout failed:", error);
    }
  };

  useEffect(() => {
    if (!isLoaded || user) return;
    
    const saveStories = async () => {
      try {
        await set('stories', JSON.stringify(stories));
      } catch (e) {
        console.error("Errore nel salvataggio su IndexedDB:", e);
      }
    };

    saveStories();
  }, [stories, isLoaded, user]);

  useEffect(() => {
    if (currentView !== 'editor' || !editingStory) {
      setLastSaved(null);
      return;
    }

    const interval = setInterval(() => {
      const currentStory = editingStoryRef.current;
      if (!currentStory) return;

      if (!user) {
        setStories(prevStories => {
          const exists = prevStories.find(s => s.id === currentStory.id);
          if (exists) {
            return prevStories.map(s => s.id === currentStory.id ? currentStory : s);
          } else {
            return [currentStory, ...prevStories];
          }
        });
        setLastSaved(new Date());
      } else {
        // Auto-save to Firestore
        const storyToSave = { ...currentStory, uid: user.uid };
        setDoc(doc(db, 'stories', currentStory.id), storyToSave)
          .then(() => setLastSaved(new Date()))
          .catch((error) => handleFirestoreError(error, OperationType.UPDATE, 'stories'));
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [currentView, editingStory, user]);

  // AUTO-PLAY NARRATION EFFECT
  useEffect(() => {
    if (currentView === 'reader' && readingStory && readingStory.pages[currentPageIndex]) {
      const page = readingStory.pages[currentPageIndex];
      // Slightly delayed to allow for transition animations
      const timer = setTimeout(() => {
        handlePlayPage(page, readingStory.voiceConfig);
      }, 500);
      return () => {
        clearTimeout(timer);
        window.speechSynthesis.cancel(); // Stop reading if they leave the page/view
      };
    }
  }, [currentView, currentPageIndex, readingStory]);

  // Timer per il cambio automatico dei media nella modalità lettura
  useEffect(() => {
    if (currentView !== 'reader' || !readingStory) return;

    const currentPage = readingStory.pages[currentPageIndex];
    if (!currentPage || !currentPage.media || currentPage.media.length <= 1) return;

    const currentMedia = currentPage.media[currentMediaIndex];
    const duration = (currentMedia?.duration || 5) * 1000;

    const timer = setTimeout(() => {
      setCurrentMediaIndex((prev) => (prev + 1) % currentPage.media.length);
    }, duration);

    return () => clearTimeout(timer);
  }, [currentView, readingStory, currentPageIndex, currentMediaIndex]);

  const handleCreateNew = (initialData?: Partial<Story>) => {
    const newStory: Story = {
      id: Math.random().toString(36).substr(2, 9),
      title: initialData?.title || '',
      pages: initialData?.pages || [{ id: 'p1', text: '', media: [{ id: 'm1', url: '', type: 'image', duration: 5 }] }],
      createdAt: Date.now(),
      voiceConfig: { ...globalVoiceConfig }
    };
    setEditingStory(newStory);
    setCurrentView('editor');
  };

  const generatePrompt = async () => {
    if (!promptTheme.trim()) return;
    setIsGeneratingPrompt(true);
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error("DeepSeek API Key non trovata.");

      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'user',
              content: `Genera un prompt creativo per una fiaba per bambini. 
              Tema: ${promptTheme}
              Parole chiave: ${promptKeywords}
              Il prompt deve essere una breve descrizione della trama (max 300 caratteri) che possa ispirare la scrittura della storia.
              Rispondi solo con il testo del prompt, in italiano.`
            }
          ]
        })
      });

      const data = await response.json();
      const promptText = data.choices?.[0]?.message?.content || "Errore nella generazione del prompt.";
      
      if (user) {
        const newPrompt: StoryPrompt = {
          id: Math.random().toString(36).substr(2, 9),
          uid: user.uid,
          theme: promptTheme,
          keywords: promptKeywords.split(',').map(k => k.trim()).filter(k => k),
          promptText,
          createdAt: Date.now()
        };
        await setDoc(doc(db, 'prompts', newPrompt.id), newPrompt);
      }
    } catch (error) {
      console.error("Errore generazione prompt (DeepSeek):", error);
      alert("Errore durante la generazione del prompt con DeepSeek. Verifica la chiave o la connessione.");
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const deletePrompt = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'prompts', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `prompts/${id}`);
    }
  };

  const handleEdit = (story: Story) => {
    setEditingStory(story);
    setCurrentView('editor');
  };

  const handleRead = (story: Story) => {
    setReadingStory(story);
    setCurrentPageIndex(0);
    setCurrentMediaIndex(0);
    setShowText(false);
    setCurrentView('reader');
  };

  const handleDelete = async (id: string) => {
    if (!user) {
      setStories(stories.filter(s => s.id !== id));
      return;
    }

    try {
      await deleteDoc(doc(db, 'stories', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `stories/${id}`);
    }
  };

  const handleSave = async () => {
    if (!editingStory) return;
    
    if (!user) {
      setStories(prev => {
        const exists = prev.find(s => s.id === editingStory.id);
        if (exists) {
          return prev.map(s => s.id === editingStory.id ? editingStory : s);
        } else {
          return [editingStory, ...prev];
        }
      });
      setCurrentView('dashboard');
      return;
    }

    try {
      const storyToSave = { ...editingStory, uid: user.uid };
      await setDoc(doc(db, 'stories', editingStory.id), storyToSave);
      setLastSaved(new Date());
      setCurrentView('dashboard');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `stories/${editingStory.id}`);
    }
  };

  const handleTestVoice = async (text: string) => {
    if (!editingStory || !text) return;
    setIsGenerating(true);
    try {
      await generateSpeech(text, {
        voiceName: editingStory.voiceConfig.voiceName,
        speed: editingStory.voiceConfig.speed,
        pitch: editingStory.voiceConfig.pitch,
        emotion: editingStory.voiceConfig.emotion
      });
    } catch (error: any) {
      console.error("Errore test voce:", error);
      alert("Errore nella riproduzione vocale. Assicurati che il browser supporti la sintesi vocale.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlayPage = async (page: StoryPage, config: any) => {
    if (!page.text) return;
    setIsGenerating(true);
    try {
      await generateSpeech(page.text, config);
    } catch (error) {
      alert("Errore nella riproduzione.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePreviewVoice = async () => {
    if (!editingStory) return;
    setIsGenerating(true);
    try {
      const previewText = `Ciao! Io sono ${editingStory.voiceConfig.voiceName}, la tua voce narrante. Sto leggendo con velocità ${editingStory.voiceConfig.speed.toFixed(1)} e tono ${editingStory.voiceConfig.pitch.toFixed(1)}.`;
      await generateSpeech(previewText, {
        voiceName: editingStory.voiceConfig.voiceName,
        speed: editingStory.voiceConfig.speed,
        pitch: editingStory.voiceConfig.pitch,
        emotion: editingStory.voiceConfig.emotion
      });
    } catch (error) {
      alert("Errore nell'anteprima della voce.");
    } finally {
      setIsGenerating(false);
    }
  };

  const generateFullStory = async () => {
    if (!editingStory || !editingStory.title) {
        alert("Inserisci un titolo prima di generare la storia!");
        return;
    }
    
    setIsGenerating(true);
    try {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) throw new Error("Chiave DeepSeek mancante.");

        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    {
                        role: 'user',
                        content: `Scrivi una fiaba breve per bambini in 5 pagine. 
                        Titolo: ${editingStory.title}
                        Lingua: Italiano.
                        Formatta il risultato come un array JSON di oggetti con struttura: [{"text": "testo pagina 1"}, {"text": "testo pagina 2"}, ...].
                        Ogni pagina deve avere circa 40-60 parole.
                        Rispondi SOLO con il JSON.`
                    }
                ],
                response_format: { type: 'json_object' }
            })
        });

        const data = await response.json();
        const content = data.choices[0].message.content;
        const parsed = JSON.parse(content);
        const storyPages = parsed.pages || parsed; // Handle potential wrappers

        if (Array.isArray(storyPages)) {
            const newPages: StoryPage[] = storyPages.map((p: any, i: number) => ({
                id: `p-${Date.now()}-${i}`,
                text: p.text,
                media: [{ id: `m-${Date.now()}-${i}`, url: '', type: 'image', duration: 5 }]
            }));

            setEditingStory({
                ...editingStory,
                pages: newPages
            });
        }
    } catch (error) {
        console.error("Errore Magic Write:", error);
        alert("Errore nella generazione della storia. Riprova.");
    } finally {
        setIsGenerating(false);
    }
  };

  const addPage = () => {
    if (!editingStory) return;
    const newPage: StoryPage = {
      id: Math.random().toString(36).substr(2, 9),
      text: '',
      media: [{ id: 'm1', url: '', type: 'image', duration: 5 }]
    };
    setEditingStory({
      ...editingStory,
      pages: [...editingStory.pages, newPage]
    });
  };

  const movePage = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    setEditingStory(prev => {
      if (!prev) return null;
      const newPages = [...prev.pages];
      if (targetIndex < 0 || targetIndex >= newPages.length) return prev;
      [newPages[index], newPages[targetIndex]] = [newPages[targetIndex], newPages[index]];
      return { ...prev, pages: newPages };
    });
  };

  const removePage = (index: number) => {
    setEditingStory(prev => {
      if (!prev || prev.pages.length <= 1) return prev;
      const newPages = prev.pages.filter((_, i) => i !== index);
      return { ...prev, pages: newPages };
    });
  };

  const updatePage = (index: number, updates: Partial<StoryPage>) => {
    setEditingStory(prev => {
      if (!prev) return null;
      const newPages = prev.pages.map((p, i) => i === index ? { ...p, ...updates } : p);
      return { ...prev, pages: newPages };
    });
  };

  const handleMediaUpload = async (pageIndex: number, mediaIndex: number, file: File) => {
    if (!user) {
      // Fallback for non-logged in users: use base64 (but warn about size)
      const reader = new FileReader();
      reader.onloadend = () => {
        const isVideo = file.type.startsWith('video/');
        setEditingStory(prev => {
          if (!prev) return null;
          const newPages = [...prev.pages];
          newPages[pageIndex].media[mediaIndex] = {
            ...newPages[pageIndex].media[mediaIndex],
            url: reader.result as string,
            type: isVideo ? 'video' : 'image'
          };
          return { ...prev, pages: newPages };
        });
      };
      reader.readAsDataURL(file);
      return;
    }

    try {
      // Set uploading state for this specific item
      setEditingStory(prev => {
        if (!prev) return null;
        const newPages = [...prev.pages];
        newPages[pageIndex].media[mediaIndex] = {
          ...newPages[pageIndex].media[mediaIndex],
          uploading: true
        };
        return { ...prev, pages: newPages };
      });

      const isVideo = file.type.startsWith('video/');
      const fileExtension = file.name.split('.').pop();
      const fileName = `${user.uid}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExtension}`;
      const storageRef = ref(storage, `media/${fileName}`);
      
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      setEditingStory(prev => {
        if (!prev) return null;
        const newPages = [...prev.pages];
        newPages[pageIndex].media[mediaIndex] = {
          ...newPages[pageIndex].media[mediaIndex],
          url: downloadURL,
          type: isVideo ? 'video' : 'image',
          uploading: false
        };
        return { ...prev, pages: newPages };
      });
    } catch (error: any) {
      console.error("Errore durante l'upload del file:", error);
      let message = "Errore durante l'upload del file. Riprova.";
      if (error.code === 'storage/unauthorized') {
        message = "Permesso negato per l'upload su Firebase Storage. Verifica le regole di sicurezza nel pannello Firebase.";
      } else if (error.code === 'storage/canceled') {
        message = "Upload annullato.";
      }
      alert(message);
      
      // Reset uploading state on error
      setEditingStory(prev => {
        if (!prev) return null;
        const newPages = [...prev.pages];
        newPages[pageIndex].media[mediaIndex] = {
          ...newPages[pageIndex].media[mediaIndex],
          uploading: false
        };
        return { ...prev, pages: newPages };
      });
    }
  };

  const calculateReadingTime = (text: string, speed: number) => {
    const words = text.trim().split(/\s+/).length;
    // Media di 150 parole al minuto (2.5 parole al secondo)
    // Regolato dalla velocità della voce
    const baseWordsPerSecond = 2.5;
    const actualWordsPerSecond = baseWordsPerSecond * speed;
    return Math.ceil(words / actualWordsPerSecond) || 0;
  };

  const addMediaToPage = (pageIndex: number) => {
    setEditingStory(prev => {
      if (!prev) return null;
      const newPages = [...prev.pages];
      newPages[pageIndex].media.push({
        id: Math.random().toString(36).substr(2, 9),
        url: '',
        type: 'image',
        duration: 5
      });
      return { ...prev, pages: newPages };
    });
  };

  const removeMediaFromPage = (pageIndex: number, mediaIndex: number) => {
    setEditingStory(prev => {
      if (!prev || prev.pages[pageIndex].media.length <= 1) return prev;
      const newPages = [...prev.pages];
      newPages[pageIndex].media = newPages[pageIndex].media.filter((_, i) => i !== mediaIndex);
      return { ...prev, pages: newPages };
    });
  };

  const updateMediaItem = (pageIndex: number, mediaIndex: number, updates: any) => {
    setEditingStory(prev => {
      if (!prev) return null;
      const newPages = [...prev.pages];
      newPages[pageIndex].media[mediaIndex] = {
        ...newPages[pageIndex].media[mediaIndex],
        ...updates
      };
      return { ...prev, pages: newPages };
    });
  };

  const suggestImagePrompt = async (pageText: string) => {
    if (!pageText.trim()) return "";
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) return "";

      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'user',
              content: `Basandoti sul seguente testo di una fiaba, scrivi un prompt descrittivo e dettagliato in inglese per un generatore di immagini AI.
              Il prompt deve descrivere lo stile (es. illustrazione per bambini, acquerello, fiabesco), i personaggi, l'ambientazione e l'atmosfera.
              Testo della pagina: "${pageText}"
              Rispondi solo con il prompt in inglese.`
            }
          ]
        })
      });

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || "";
    } catch (error) {
      console.error("Errore suggerimento prompt (DeepSeek):", error);
      return "";
    }
  };

  const openAIImageModal = async (pageIndex: number, mediaIndex: number) => {
    if (!editingStory) return;
    const page = editingStory.pages[pageIndex];
    setIsGeneratingImage(page.id);
    try {
      const suggested = await suggestImagePrompt(page.text);
      setAiImagePromptModal({ pageIndex, mediaIndex, prompt: suggested });
    } finally {
      setIsGeneratingImage(null);
    }
  };

  const generateAIImage = async (pageIndex: number, mediaIndex: number, customPrompt?: string) => {
    if (!editingStory) return;
    const page = editingStory.pages[pageIndex];
    const pageId = page.id;
    
    setIsGeneratingImage(pageId);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let finalPrompt = customPrompt;
      if (!finalPrompt) {
        finalPrompt = await suggestImagePrompt(page.text);
      }
      
      if (!finalPrompt) {
        finalPrompt = `A beautiful fairy tale illustration for children based on: ${page.text.substring(0, 200)}`;
      }

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: finalPrompt,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
          },
        },
      });

      let imageUrl = "";
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (imageUrl) {
        if (user) {
          // Upload to Firebase Storage for persistence
          const blob = await (await fetch(imageUrl)).blob();
          const file = new File([blob], `ai-gen-${Date.now()}.png`, { type: 'image/png' });
          await handleMediaUpload(pageIndex, mediaIndex, file);
        } else {
          // Local update
          updateMediaItem(pageIndex, mediaIndex, { url: imageUrl, type: 'image' });
        }
      } else {
        throw new Error("Nessuna immagine generata dal modello.");
      }
    } catch (error: any) {
      console.error("Errore generazione immagine AI:", error);
      alert(`Errore durante la generazione dell'immagine: ${error.message || 'Errore sconosciuto'}`);
    } finally {
      setIsGeneratingImage(null);
    }
  };

  const exportToPDF = async (story: Story, format: 'a4' | 'a5') => {
    setIsExporting(true);
    setExportProgress(0);
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: format
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Create a hidden container for rendering
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '2400px'; // Increased for higher resolution
    document.body.appendChild(container);

    try {
      // 1. Cover Page
      setExportProgress(5);
      const coverSpread = document.createElement('div');
      coverSpread.style.width = '1200px';
      coverSpread.style.height = '840px';
      coverSpread.style.backgroundColor = '#fdfcfb';
      coverSpread.style.display = 'flex';
      coverSpread.style.flexDirection = 'column';
      coverSpread.style.alignItems = 'center';
      coverSpread.style.justifyContent = 'center';
      coverSpread.style.fontFamily = "'Outfit', sans-serif";
      coverSpread.style.padding = '80px';
      coverSpread.style.textAlign = 'center';

      const coverTitle = document.createElement('h1');
      coverTitle.innerText = story.title;
      coverTitle.style.fontSize = '72px';
      coverTitle.style.fontWeight = '800';
      coverTitle.style.color = '#451a03';
      coverTitle.style.marginBottom = '20px';
      coverTitle.style.letterSpacing = '-0.02em';
      coverSpread.appendChild(coverTitle);

      const coverAuthor = document.createElement('p');
      coverAuthor.innerText = `Scritta da ${user?.displayName || 'un narratore anonimo'}`;
      coverAuthor.style.fontSize = '24px';
      coverAuthor.style.color = '#92400e';
      coverAuthor.style.fontWeight = '500';
      coverSpread.appendChild(coverAuthor);

      const coverDecoration = document.createElement('div');
      coverDecoration.style.width = '120px';
      coverDecoration.style.height = '4px';
      coverDecoration.style.backgroundColor = '#f59e0b';
      coverDecoration.style.marginTop = '40px';
      coverDecoration.style.borderRadius = '2px';
      coverSpread.appendChild(coverDecoration);

      container.appendChild(coverSpread);
      const coverCanvas = await html2canvas(coverSpread, { scale: 2.5, useCORS: true, logging: false });
      pdf.addImage(coverCanvas.toDataURL('image/jpeg', 0.98), 'JPEG', 0, 0, pageWidth, pageHeight);
      container.removeChild(coverSpread);

      // 2. Story Pages
      for (let i = 0; i < story.pages.length; i++) {
        setExportProgress(Math.round(10 + ((i + 1) / story.pages.length) * 90));
        const page = story.pages[i];
        
        const spread = document.createElement('div');
        spread.style.display = 'flex';
        spread.style.width = '1200px';
        spread.style.height = '840px';
        spread.style.backgroundColor = 'white';
        spread.style.fontFamily = "'Outfit', sans-serif";
        spread.style.overflow = 'hidden';

        // Left side: Image with elegant frame
        const left = document.createElement('div');
        left.style.flex = '1.2';
        left.style.padding = '60px';
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.justifyContent = 'center';
        left.style.backgroundColor = '#fafaf9';

        const imgFrame = document.createElement('div');
        imgFrame.style.width = '100%';
        imgFrame.style.height = '100%';
        imgFrame.style.padding = '15px';
        imgFrame.style.backgroundColor = 'white';
        imgFrame.style.boxShadow = '0 20px 50px rgba(0,0,0,0.12)';
        imgFrame.style.borderRadius = '4px';
        imgFrame.style.display = 'flex';
        imgFrame.style.alignItems = 'center';
        imgFrame.style.justifyContent = 'center';

        const img = document.createElement('img');
        const imageUrl = page.media[0]?.url || 'https://picsum.photos/seed/placeholder/1200/800';
        img.crossOrigin = 'anonymous';
        img.src = imageUrl;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        imgFrame.appendChild(img);
        left.appendChild(imgFrame);

        // Right side: Text with better typography
        const right = document.createElement('div');
        right.style.flex = '1';
        right.style.padding = '80px 60px';
        right.style.display = 'flex';
        right.style.flexDirection = 'column';
        right.style.justifyContent = 'center';
        right.style.color = '#1c1917';
        right.style.backgroundColor = 'white';

        const pageNum = document.createElement('div');
        pageNum.innerText = `CAPITOLO ${i + 1}`;
        pageNum.style.fontSize = '12px';
        pageNum.style.fontWeight = '800';
        pageNum.style.color = '#f59e0b';
        pageNum.style.marginBottom = '24px';
        pageNum.style.letterSpacing = '3px';
        right.appendChild(pageNum);

        const content = document.createElement('div');
        content.style.fontSize = '28px';
        content.style.lineHeight = '1.7';
        content.style.fontFamily = "'Playfair Display', serif";
        content.style.fontStyle = 'italic';
        content.style.color = '#44403c';
        content.style.whiteSpace = 'pre-wrap';
        content.innerHTML = page.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>');
        right.appendChild(content);

        const footer = document.createElement('div');
        footer.innerText = `— ${i + 1} —`;
        footer.style.marginTop = 'auto';
        footer.style.textAlign = 'center';
        footer.style.fontSize = '14px';
        footer.style.color = '#d6d3d1';
        footer.style.fontFamily = "'Outfit', sans-serif";
        right.appendChild(footer);

        spread.appendChild(left);
        spread.appendChild(right);
        container.appendChild(spread);

        // Wait for image to load
        await new Promise((resolve) => {
          if (img.complete) resolve(null);
          else {
            img.onload = () => resolve(null);
            img.onerror = () => resolve(null);
          }
        });

        const canvas = await html2canvas(spread, { 
          useCORS: true,
          scale: 2.5,
          logging: false,
          onclone: (clonedDoc) => {
            const styles = clonedDoc.querySelectorAll('style, link[rel="stylesheet"]');
            styles.forEach(s => s.remove());
            const fontStyle = clonedDoc.createElement('style');
            fontStyle.innerHTML = "@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800&family=Playfair+Display:ital,wght@0,400;0,700;1,400&display=swap');";
            clonedDoc.head.appendChild(fontStyle);
          }
        });
        
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, pageHeight);
        
        container.removeChild(spread);
      }

      console.log("Saving PDF...");
      pdf.save(`${story.title.replace(/\s+/g, '_')}_${format.toUpperCase()}.pdf`);
    } catch (error: any) {
      console.error("Errore esportazione PDF:", error);
      alert(`Errore durante l'esportazione del PDF: ${error.message || 'Errore sconosciuto'}`);
    } finally {
      if (container.parentNode) document.body.removeChild(container);
      setIsExporting(false);
      setExportingStory(null);
    }
  };

  const exportToAudiobook = async (story: Story) => {
    setIsExporting(true);
    setExportProgress(0);
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      alert("Chiave API Gemini non trovata. Controlla le impostazioni.");
      setIsExporting(false);
      return;
    }
    
    try {
      const audioChunks: Uint8Array[] = [];
      
      for (let i = 0; i < story.pages.length; i++) {
        setExportProgress(Math.round(((i + 1) / story.pages.length) * 100));
        const page = story.pages[i];
        if (!page.text) continue;

        const ai = new GoogleGenAI({ apiKey });
        const prompt = `NARRATORE: ${story.voiceConfig.voiceName}, Emozione: ${story.voiceConfig.emotion}, Velocità: ${story.voiceConfig.speed}x. TESTO: ${page.text}`;
        
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: prompt }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: story.voiceConfig.voiceName },
              },
            },
          },
        });

        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          const binaryString = atob(base64Audio);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }
          audioChunks.push(bytes);
        }
      }

      if (audioChunks.length === 0) throw new Error("Nessun audio generato");

      // Concatenate raw PCM data (assuming all are 24kHz, 16-bit, mono)
      const totalLen = audioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const wavHeader = createWavHeader(totalLen, 24000, 1, 16);
      
      const finalBuffer = new Uint8Array(44 + totalLen);
      finalBuffer.set(new Uint8Array(wavHeader), 0);
      let offset = 44;
      for (const chunk of audioChunks) {
        finalBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      const blob = new Blob([finalBuffer], { type: 'audio/wav' });
      saveAs(blob, `${story.title.replace(/\s+/g, '_')}_Audiobook.wav`);
    } catch (error) {
      console.error("Errore esportazione Audiobook:", error);
      alert("Errore durante la generazione dell'audiobook.");
    } finally {
      setIsExporting(false);
      setExportingStory(null);
    }
  };

  const exportToEbook = async (story: Story) => {
    setIsExporting(true);
    setExportProgress(0);
    
    try {
      const zip = new JSZip();
      
      // Basic EPUB structure
      zip.file("mimetype", "application/epub+zip");
      zip.file("META-INF/container.xml", `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

      let manifest = "";
      let spine = "";
      
      for (let i = 0; i < story.pages.length; i++) {
        const page = story.pages[i];
        const fileName = `page_${i + 1}.xhtml`;
        
        const htmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${story.title} - Page ${i + 1}</title></head>
<body style="font-family: sans-serif; padding: 20px;">
  <h1 style="color: #666; font-size: 14px; text-transform: uppercase;">${story.title}</h1>
  <div style="margin: 20px 0; text-align: center;">
    <img src="${page.media[0]?.url}" style="max-width: 100%; height: auto; border-radius: 8px;" />
  </div>
  <div style="font-size: 18px; line-height: 1.6; color: #333;">
    ${page.text.replace(/\n/g, '<br/>')}
  </div>
</body>
</html>`;
        
        zip.file(`OEBPS/${fileName}`, htmlContent);
        manifest += `<item id="page${i + 1}" href="${fileName}" media-type="application/xhtml+xml"/>\n`;
        spine += `<itemref idref="page${i + 1}"/>\n`;
      }

      zip.file("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${story.title}</dc:title>
    <dc:language>it</dc:language>
    <dc:creator>Narratore di Fiabe</dc:creator>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine toc="ncx">
    ${spine}
  </spine>
</package>`);

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `${story.title.replace(/\s+/g, '_')}.epub`);
    } catch (error) {
      console.error("Errore esportazione Ebook:", error);
      alert("Errore durante la generazione dell'ebook.");
    } finally {
      setIsExporting(false);
      setExportingStory(null);
    }
  };

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

  return (
    <ErrorBoundary>
      <div className="min-h-screen font-sans bg-stone-50">
      {currentView !== 'reader' && (
        <header className="p-4 md:p-6 flex flex-col md:flex-row justify-between items-center gap-4 max-w-6xl mx-auto">
          <div className="flex items-center justify-between w-full md:w-auto">
            <div className="flex items-center gap-2">
              <div className="bg-amber-500 p-2 rounded-xl shadow-lg">
                <Book className="text-white w-5 h-5 md:w-6 md:h-6" />
              </div>
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-stone-800">Narratore di Fiabe</h1>
            </div>
            <div className="md:hidden flex items-center gap-2">
              {user && (
                <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full border border-stone-100" />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-2 md:gap-4 w-full md:w-auto">
            {user ? (
              <div className="hidden md:flex items-center gap-3 bg-white p-1 pr-4 rounded-full shadow-sm border border-stone-100">
                <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-8 h-8 rounded-full" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-stone-400 uppercase leading-none">Bentornato</span>
                  <span className="text-xs font-bold text-stone-700">{user.displayName}</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="ml-2 p-1.5 hover:bg-stone-100 rounded-full text-stone-400 hover:text-red-500 transition-colors"
                  title="Logout"
                >
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 bg-white text-stone-700 px-3 md:px-4 py-2 rounded-full border border-stone-200 hover:bg-stone-50 transition-all text-xs md:text-sm font-bold shadow-sm"
              >
                <LogIn className="text-amber-500 w-4 h-4 md:w-[18px] md:h-[18px]" />
                <span className="hidden sm:inline">Accedi con Google</span>
                <span className="sm:hidden">Accedi</span>
              </button>
            )}
            
            <button 
              onClick={() => setShowSetupModal(true)}
              className="flex items-center gap-2 bg-white text-stone-700 px-3 md:px-4 py-2 rounded-full border border-stone-200 hover:bg-stone-50 transition-all text-xs md:text-sm font-bold shadow-sm"
            >
              <Settings className="text-stone-500 w-4 h-4 md:w-[18px] md:h-[18px]" />
              <span className="hidden sm:inline">Setup</span>
            </button>

            <button 
              onClick={() => setShowPromptGenerator(true)}
              className="flex items-center gap-2 bg-white text-stone-700 px-3 md:px-4 py-2 rounded-full border border-stone-200 hover:bg-stone-50 transition-all text-xs md:text-sm font-bold shadow-sm"
            >
              <Sparkles className="text-amber-500 w-4 h-4 md:w-[18px] md:h-[18px]" />
              <span className="hidden sm:inline">Idee Fiabe</span>
              <span className="sm:hidden">Idee</span>
            </button>

            {currentView === 'dashboard' && (
              <button 
                onClick={() => handleCreateNew()}
                className="flex items-center gap-2 bg-stone-900 text-white px-3 md:px-4 py-2 rounded-full hover:bg-stone-800 transition-all shadow-md text-xs md:text-sm"
              >
                <Plus className="w-4 h-4 md:w-[18px] md:h-[18px]" />
                <span className="hidden sm:inline">Nuovo Libro</span>
                <span className="sm:hidden">Nuovo</span>
              </button>
            )}

            {user && (
              <button 
                onClick={handleLogout}
                className="md:hidden p-2 bg-white text-stone-400 hover:text-red-500 rounded-full border border-stone-200 shadow-sm"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </header>
      )}

      <main className={currentView === 'reader' ? '' : 'max-w-6xl mx-auto p-4 md:p-6'}>
        {/* Prompt Generator Modal */}
        <AnimatePresence>
          {showPromptGenerator && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowPromptGenerator(false)}
                className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative bg-white rounded-[2rem] md:rounded-[40px] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[95vh] md:max-h-[90vh]"
              >
                <div className="p-6 md:p-8 border-b border-stone-100 flex justify-between items-center">
                  <div className="flex items-center gap-2 md:gap-3">
                    <div className="w-8 h-8 md:w-10 md:h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600">
                      <Sparkles className="w-5 h-5 md:w-6 md:h-6" />
                    </div>
                    <div>
                      <h2 className="text-xl md:text-2xl font-serif font-bold text-stone-800">Generatore di Idee</h2>
                      <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider">Lasciati ispirare dall'IA</p>
                    </div>
                  </div>
                  <button onClick={() => setShowPromptGenerator(false)} className="text-stone-400 hover:text-stone-600 p-1">
                    <X className="w-5 h-5 md:w-6 md:h-6" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 md:space-y-8 custom-scrollbar">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Tema Principale</label>
                      <input 
                        type="text" 
                        value={promptTheme}
                        onChange={(e) => setPromptTheme(e.target.value)}
                        placeholder="Es: Un castello tra le nuvole..."
                        className="w-full bg-stone-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Parole Chiave (opzionali)</label>
                      <input 
                        type="text" 
                        value={promptKeywords}
                        onChange={(e) => setPromptKeywords(e.target.value)}
                        placeholder="Es: drago, amicizia, coraggio..."
                        className="w-full bg-stone-50 border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-amber-500"
                      />
                    </div>
                  </div>

                  <button 
                    onClick={generatePrompt}
                    disabled={isGeneratingPrompt || !promptTheme.trim()}
                    className="w-full bg-amber-500 text-white py-3 md:py-4 rounded-2xl font-bold shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm md:text-base"
                  >
                    {isGeneratingPrompt ? <Loader2 className="animate-spin w-[18px] h-[18px] md:w-5 md:h-5" /> : <Sparkles className="w-[18px] h-[18px] md:w-5 md:h-5" />}
                    Genera Nuova Idea
                  </button>

                  <div className="space-y-4">
                    <h3 className="text-[10px] md:text-sm font-bold text-stone-400 uppercase tracking-widest">Le tue Idee Salvate</h3>
                    <div className="grid grid-cols-1 gap-3 md:gap-4">
                      {prompts.length === 0 ? (
                        <div className="text-center py-8 md:py-12 bg-stone-50 rounded-3xl border-2 border-dashed border-stone-200">
                          <p className="text-stone-400 text-xs md:text-sm">Non hai ancora generato nessuna idea.</p>
                        </div>
                      ) : (
                        prompts.map((p) => (
                          <div key={p.id} className="p-4 md:p-6 bg-stone-50 rounded-3xl border border-stone-100 space-y-3 md:space-y-4 group">
                            <div className="flex justify-between items-start">
                              <div className="flex flex-wrap gap-1.5 md:gap-2">
                                <span className="text-[9px] md:text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-bold uppercase">{p.theme}</span>
                                {p.keywords.map((k, i) => (
                                  <span key={i} className="text-[9px] md:text-[10px] bg-stone-200 text-stone-600 px-2 py-1 rounded-full font-bold uppercase">{k}</span>
                                ))}
                              </div>
                              <button 
                                onClick={() => deletePrompt(p.id)}
                                className="text-stone-300 hover:text-red-500 transition-colors md:opacity-0 md:group-hover:opacity-100 p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" />
                              </button>
                            </div>
                            <p className="text-stone-700 text-xs md:text-sm leading-relaxed italic">"{p.promptText}"</p>
                            <button 
                              onClick={() => {
                                handleCreateNew({ title: p.theme, pages: [{ id: 'p1', text: p.promptText, media: [{ id: 'm1', url: '', type: 'image', duration: 5 }] }] });
                                setShowPromptGenerator(false);
                              }}
                              className="text-[10px] md:text-xs text-amber-600 font-bold flex items-center gap-1 hover:underline"
                            >
                              <Plus className="w-3 h-3 md:w-3.5 md:h-3.5" />
                              Usa questa idea per una nuova fiaba
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Export Modal */}
        <AnimatePresence>
          {exportingStory && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => !isExporting && setExportingStory(null)}
                className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="relative bg-white rounded-[2rem] md:rounded-[40px] shadow-2xl w-full max-w-md overflow-hidden"
              >
                <div className="p-6 md:p-8 space-y-4 md:space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl md:text-2xl font-serif font-bold text-stone-800">Esporta Fiaba</h2>
                    {!isExporting && (
                      <button onClick={() => setExportingStory(null)} className="text-stone-400 hover:text-stone-600 p-1">
                        <X className="w-5 h-5 md:w-6 md:h-6" />
                      </button>
                    )}
                  </div>

                  <p className="text-stone-500 text-xs md:text-sm">
                    Scegli il formato desiderato per esportare <strong>{exportingStory.title}</strong>.
                  </p>

                  {isExporting ? (
                    <div className="py-12 flex flex-col items-center justify-center space-y-6">
                      <div className="relative">
                        <Loader2 className="animate-spin text-amber-500" size={64} />
                        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-amber-600">
                          {exportProgress}%
                        </div>
                      </div>
                      <div className="text-center">
                        <p className="font-bold text-stone-800">Generazione in corso...</p>
                        <p className="text-xs text-stone-400 mt-1">Non chiudere la finestra</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      <button 
                        onClick={() => exportToPDF(exportingStory, 'a4')}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-stone-50 hover:bg-amber-50 border border-stone-100 hover:border-amber-200 transition-all group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
                          <FileText size={24} />
                        </div>
                        <div className="text-left">
                          <div className="font-bold text-stone-800">PDF (Formato A4)</div>
                          <div className="text-xs text-stone-400">Layout libro con immagini e testo</div>
                        </div>
                      </button>

                      <button 
                        onClick={() => exportToPDF(exportingStory, 'a5')}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-stone-50 hover:bg-amber-50 border border-stone-100 hover:border-amber-200 transition-all group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
                          <FileText size={24} />
                        </div>
                        <div className="text-left">
                          <div className="font-bold text-stone-800">PDF (Formato A5)</div>
                          <div className="text-xs text-stone-400">Formato tascabile ideale per stampa</div>
                        </div>
                      </button>

                      <button 
                        onClick={() => exportToAudiobook(exportingStory)}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-stone-50 hover:bg-amber-50 border border-stone-100 hover:border-amber-200 transition-all group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
                          <Headphones size={24} />
                        </div>
                        <div className="text-left">
                          <div className="font-bold text-stone-800">Audiobook (WAV)</div>
                          <div className="text-xs text-stone-400">Tutte le pagine narrate in un unico file</div>
                        </div>
                      </button>

                      <button 
                        onClick={() => exportToEbook(exportingStory)}
                        className="flex items-center gap-4 p-4 rounded-2xl bg-stone-50 hover:bg-amber-50 border border-stone-100 hover:border-amber-200 transition-all group"
                      >
                        <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600 group-hover:scale-110 transition-transform">
                          <BookOpen size={24} />
                        </div>
                        <div className="text-left">
                          <div className="font-bold text-stone-800">Ebook (EPUB)</div>
                          <div className="text-xs text-stone-400">Formato standard per e-reader</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {currentView === 'dashboard' ? (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -10 }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6"
            >
              {stories.map((story) => (
                <div key={story.id} className="glass rounded-3xl overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
                  <div className="h-40 md:h-48 bg-stone-200 relative">
                    {story.pages?.[0]?.media?.[0]?.url ? (
                      story.pages[0].media[0].type === 'video' ? (
                        <video 
                          src={story.pages[0].media[0].url} 
                          className="w-full h-full object-cover" 
                          muted 
                          loop 
                          playsInline 
                          autoPlay 
                        />
                      ) : (
                        <img 
                          src={story.pages[0].media[0].url} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer" 
                          loading="lazy"
                        />
                      )
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-stone-400">
                        <Sparkles className="w-10 h-10 md:w-12 md:h-12" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center gap-3 md:gap-4 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100">
                      <button 
                        onClick={() => handleRead(story)}
                        className="bg-white p-2.5 md:p-3 rounded-full shadow-lg hover:scale-110 transition-transform"
                        title="Leggi"
                      >
                        <Play className="text-amber-600 w-5 h-5 md:w-6 md:h-6" />
                      </button>
                      <button 
                        onClick={() => handleEdit(story)}
                        className="bg-white p-2.5 md:p-3 rounded-full shadow-lg hover:scale-110 transition-transform"
                        title="Modifica"
                      >
                        <Settings className="text-stone-900 w-5 h-5 md:w-6 md:h-6" />
                      </button>
                      <button 
                        onClick={() => setExportingStory(story)}
                        className="bg-white p-2.5 md:p-3 rounded-full shadow-lg hover:scale-110 transition-transform"
                        title="Esporta"
                      >
                        <Download className="text-amber-600 w-5 h-5 md:w-6 md:h-6" />
                      </button>
                    </div>
                  </div>
                  <div className="p-4 md:p-5">
                    <h3 className="text-lg md:text-xl font-serif font-bold mb-1">{story.title || 'Senza Titolo'}</h3>
                    <p className="text-stone-500 text-xs md:text-sm line-clamp-2 mb-3 md:mb-4">{story.pages?.[0]?.text || 'Nessun contenuto...'}</p>
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] md:text-xs font-medium px-2 py-1 bg-amber-100 text-amber-700 rounded-md uppercase tracking-wider">
                        {story.pages?.length || 0} Pagine
                      </span>
                      <button 
                        onClick={() => handleDelete(story.id)}
                        className="text-stone-400 hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 className="w-4 h-4 md:w-[18px] md:h-[18px]" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          ) : currentView === 'editor' ? (
            <motion.div 
              key="editor"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className={showPreview ? "w-full max-w-[1600px] mx-auto px-2 md:px-4" : "max-w-5xl mx-auto"}
            >
              <div className="flex flex-col md:flex-row items-center justify-between mb-6 md:mb-8 gap-4">
                <div className="flex items-center gap-3 md:gap-4 w-full md:w-auto">
                  <Tooltip text="Torna alla Dashboard">
                    <button 
                      onClick={() => {
                        setCurrentView('dashboard');
                        setShowPreview(false);
                      }}
                      className="p-2 hover:bg-stone-100 rounded-full transition-colors"
                    >
                      <ChevronLeft size={24} />
                    </button>
                  </Tooltip>
                  <div className="flex flex-col">
                    <h2 className="text-xl md:text-3xl font-serif font-bold">Modifica Libro</h2>
                    {lastSaved && (
                      <span className="text-[10px] md:text-xs text-stone-400 font-medium">
                        Salvataggio automatico: {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 md:gap-3 w-full md:w-auto">
                  <Tooltip text={showPreview ? "Nascondi Anteprima" : "Mostra Anteprima Live"}>
                    <button 
                      onClick={() => setShowPreview(!showPreview)}
                      className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-full transition-all shadow-md font-bold text-xs md:text-sm ${showPreview ? 'bg-amber-500 text-white' : 'bg-white text-stone-700 border border-stone-200 hover:bg-stone-50'}`}
                    >
                      <Eye className="w-4 h-4 md:w-[18px] md:h-[18px]" />
                      Anteprima
                    </button>
                  </Tooltip>
                  <Tooltip text="Salva manualmente le modifiche">
                    <button 
                      onClick={handleSave}
                      className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-stone-900 text-white px-4 md:px-6 py-2 rounded-full hover:bg-stone-800 transition-all shadow-xl text-xs md:text-sm"
                    >
                      <Save className="w-[18px] h-[18px] md:w-5 md:h-5" />
                      Salva Tutto
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div className={`grid grid-cols-1 ${showPreview ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-4 md:gap-8 transition-all duration-500`}>
                <div className={`${showPreview ? 'lg:col-span-1' : 'lg:col-span-2'} space-y-8`}>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-stone-500 uppercase tracking-wider">Titolo del Libro</label>
                    <input 
                      type="text" 
                      value={editingStory?.title}
                      onChange={(e) => setEditingStory(s => s ? {...s, title: e.target.value} : null)}
                      placeholder="Il titolo del tuo libro..."
                      className="w-full bg-white border-none rounded-2xl p-4 text-2xl font-serif focus:ring-2 focus:ring-amber-500 shadow-sm"
                    />
                  </div>

                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-medium text-stone-500 uppercase tracking-wider">Pagine</label>
                      <div className="flex gap-4">
                        <button 
                          onClick={generateFullStory}
                          disabled={isGenerating}
                          className="flex items-center gap-1 text-purple-600 font-bold hover:underline text-sm disabled:opacity-50"
                        >
                          <Sparkles size={16} />
                          Magic Write (DeepSeek)
                        </button>
                        <button 
                          onClick={addPage}
                          className="flex items-center gap-1 text-amber-600 font-bold hover:underline text-sm"
                        >
                          <Plus size={16} />
                          Aggiungi Pagina
                        </button>
                      </div>
                    </div>

                    <div className="space-y-8">
                      {editingStory?.pages.map((page, index) => (
                        <div key={page.id} className="glass rounded-3xl p-6 relative group">
                          <div className="absolute -top-2 -right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip text="Anteprima Live">
                              <button 
                                onClick={() => {
                                  setPreviewPageIndex(index);
                                  setShowPreview(true);
                                }}
                                className={`p-1.5 rounded-full shadow-lg transition-all ${showPreview && previewPageIndex === index ? 'bg-amber-500 text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`}
                              >
                                <Eye size={16} />
                              </button>
                            </Tooltip>
                            <Tooltip text="Sposta su">
                              <button 
                                onClick={() => movePage(index, 'up')}
                                disabled={index === 0}
                                className="bg-white text-stone-600 p-1.5 rounded-full shadow-lg hover:bg-stone-50 disabled:opacity-30"
                              >
                                <ChevronUp size={16} />
                              </button>
                            </Tooltip>
                            <Tooltip text="Sposta giù">
                              <button 
                                onClick={() => movePage(index, 'down')}
                                disabled={index === (editingStory?.pages.length || 0) - 1}
                                className="bg-white text-stone-600 p-1.5 rounded-full shadow-lg hover:bg-stone-50 disabled:opacity-30"
                              >
                                <ChevronDown size={16} />
                              </button>
                            </Tooltip>
                            <Tooltip text="Rimuovi pagina">
                              <button 
                                onClick={() => removePage(index)}
                                className="bg-red-500 text-white p-1.5 rounded-full shadow-lg hover:bg-red-600"
                              >
                                <X size={16} />
                              </button>
                            </Tooltip>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-6">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-stone-400 uppercase">Elementi Multimediali ({page.media.length})</span>
                                <button 
                                  onClick={() => addMediaToPage(index)}
                                  className="text-[10px] text-amber-600 font-bold hover:underline"
                                >
                                  + Aggiungi Media
                                </button>
                              </div>
                              
                              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                {page.media.map((media, mIndex) => (
                                  <div key={media.id} className="p-4 bg-stone-100 rounded-2xl space-y-3 relative group/media">
                                  <Tooltip text="Rimuovi questo elemento multimediale">
                                    <button 
                                      onClick={() => removeMediaFromPage(index, mIndex)}
                                      className="absolute -top-1 -right-1 bg-white text-red-500 p-1 rounded-full shadow-sm opacity-0 group-hover/media:opacity-100 transition-opacity"
                                    >
                                      <X size={12} />
                                    </button>
                                  </Tooltip>
                                    
                                    <div className="h-24 bg-stone-200 rounded-xl overflow-hidden relative">
                                      {media.uploading && (
                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
                                          <Loader2 className="animate-spin text-white" size={24} />
                                        </div>
                                      )}
                                      {media.url ? (
                                        <SmartMedia 
                                          url={media.url} 
                                          type={media.type} 
                                          className="w-full h-full"
                                          muted 
                                          loop 
                                          playsInline 
                                        />
                                      ) : (
                                        <div className="w-full h-full flex items-center justify-center text-stone-400">
                                          {media.type === 'video' ? <Video size={24} /> : <ImageIcon size={24} />}
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex gap-2">
                                      <button 
                                        onClick={() => updateMediaItem(index, mIndex, { type: 'image' })}
                                        className={`flex-1 p-1.5 rounded-lg text-[10px] font-bold ${media.type === 'image' ? 'bg-amber-500 text-white' : 'bg-white text-stone-500'}`}
                                      >
                                        Immagine
                                      </button>
                                      <button 
                                        onClick={() => updateMediaItem(index, mIndex, { type: 'video' })}
                                        className={`flex-1 p-1.5 rounded-lg text-[10px] font-bold ${media.type === 'video' ? 'bg-amber-500 text-white' : 'bg-white text-stone-500'}`}
                                      >
                                        Video
                                      </button>
                                    </div>

                                      <div className="flex gap-2">
                                        <input 
                                          type="text"
                                          value={media.url}
                                          onChange={(e) => updateMediaItem(index, mIndex, { url: e.target.value })}
                                          placeholder="URL..."
                                          className="flex-1 bg-white border-none rounded-lg p-2 text-[10px] focus:ring-1 focus:ring-amber-500"
                                        />
                                        <div className="flex gap-1">
                                          <Tooltip text="Genera immagine con AI">
                                            <button 
                                              onClick={() => openAIImageModal(index, mIndex)}
                                              disabled={isGeneratingImage === page.id}
                                              className="bg-amber-100 hover:bg-amber-200 p-2 rounded-lg transition-colors disabled:opacity-50"
                                            >
                                              {isGeneratingImage === page.id ? <Loader2 size={14} className="animate-spin text-amber-600" /> : <Wand2 size={14} className="text-amber-600" />}
                                            </button>
                                          </Tooltip>
                                          <label className="cursor-pointer bg-stone-200 hover:bg-stone-300 p-2 rounded-lg transition-colors">
                                            <Plus size={14} className="text-stone-600" />
                                            <input 
                                              type="file" 
                                              accept={media.type === 'video' ? "video/*" : "image/*"} 
                                              className="hidden" 
                                              onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) handleMediaUpload(index, mIndex, file);
                                              }}
                                            />
                                          </label>
                                        </div>
                                      </div>

                                    <div className="space-y-1">
                                      <div className="flex justify-between text-[9px] font-bold text-stone-400 uppercase">
                                        <span>Durata Visualizzazione</span>
                                        <span>{media.duration}s</span>
                                      </div>
                                      <input 
                                        type="range" min="1" max="30" step="1"
                                        value={media.duration}
                                        onChange={(e) => updateMediaItem(index, mIndex, { duration: parseInt(e.target.value) })}
                                        className="w-full h-1 bg-stone-300 rounded-lg appearance-none cursor-pointer accent-amber-500"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="space-y-4">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-stone-400 uppercase">Testo Pagina</label>
                                <div className="flex items-center gap-1 text-[10px] text-stone-400 font-bold">
                                  <span>Tempo Lettura Stimato:</span>
                                  <span className="text-amber-600">
                                    {calculateReadingTime(page.text, editingStory?.voiceConfig.speed || 1.0)}s
                                  </span>
                                </div>
                              </div>
                              <textarea 
                                rows={8}
                                value={page.text}
                                onChange={(e) => updatePage(index, { text: e.target.value })}
                                placeholder="Scrivi qui la tua storia..."
                                className="w-full bg-stone-50 border-none rounded-xl p-4 text-sm leading-relaxed focus:ring-2 focus:ring-amber-500 resize-none h-[260px]"
                              />
                              <div className="flex flex-wrap gap-2 py-1">
                                <span className="text-[9px] font-bold text-stone-400 uppercase w-full mb-1">Scorciatoie SSML</span>
                                <button 
                                  onClick={() => updatePage(index, { text: page.text + ' <say-as interpret-as="date" format="dmy">02-04-2026</say-as>' })}
                                  className="text-[9px] bg-stone-200 hover:bg-stone-300 px-2 py-1 rounded text-stone-600 font-medium transition-colors"
                                  title="Inserisci tag data"
                                >
                                  Data
                                </button>
                                <button 
                                  onClick={() => updatePage(index, { text: page.text + ' <say-as interpret-as="cardinal">12345</say-as>' })}
                                  className="text-[9px] bg-stone-200 hover:bg-stone-300 px-2 py-1 rounded text-stone-600 font-medium transition-colors"
                                  title="Inserisci tag numero"
                                >
                                  Numero
                                </button>
                                <button 
                                  onClick={() => updatePage(index, { text: page.text + ' <phoneme alphabet="ipa" ph="təmeɪtoʊ">tomato</phoneme>' })}
                                  className="text-[9px] bg-stone-200 hover:bg-stone-300 px-2 py-1 rounded text-stone-600 font-medium transition-colors"
                                  title="Inserisci tag fonema"
                                >
                                  Fonema
                                </button>
                                <button 
                                  onClick={() => updatePage(index, { text: page.text + ' <break time="1s"/>' })}
                                  className="text-[9px] bg-stone-200 hover:bg-stone-300 px-2 py-1 rounded text-stone-600 font-medium transition-colors"
                                  title="Inserisci tag pausa"
                                >
                                  Pausa
                                </button>
                                <button 
                                  onClick={() => updatePage(index, { text: page.text + ' <emphasis level="strong">parola</emphasis>' })}
                                  className="text-[9px] bg-stone-200 hover:bg-stone-300 px-2 py-1 rounded text-stone-600 font-medium transition-colors"
                                  title="Inserisci tag enfasi"
                                >
                                  Enfasi
                                </button>
                                <button 
                                  onClick={() => {
                                    const example = `Oggi è il <say-as interpret-as="date" format="dmy">02-04-2026</say-as>. <break time="1s"/> Ho contato <say-as interpret-as="cardinal">12345</say-as> stelle. Alcuni dicono <phoneme alphabet="ipa" ph="təmeɪtoʊ">tomato</phoneme>, altri <phoneme alphabet="ipa" ph="təmɑːtoʊ">tomato</phoneme>. Ma conta <emphasis level="strong">l'avventura</emphasis>!`;
                                    updatePage(index, { text: example });
                                  }}
                                  className="text-[9px] bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded text-amber-700 font-bold transition-colors ml-auto"
                                  title="Carica un esempio completo di SSML"
                                >
                                  Carica Esempio Completo
                                </button>
                              </div>
                              <div className="flex justify-between items-center">
                                <button 
                                  onClick={() => handleTestVoice(page.text)}
                                  disabled={isGenerating || !page.text}
                                  className="flex items-center gap-2 text-stone-500 hover:text-amber-600 transition-colors text-xs font-bold uppercase"
                                >
                                  <Volume2 size={16} />
                                  Prova Voce Pagina
                                </button>
                                <div className="text-[9px] text-stone-400 italic">
                                  Durata Totale Media: {page.media.reduce((acc, m) => acc + m.duration, 0)}s
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-stone-900 text-white text-[10px] flex items-center justify-center rounded-full font-bold">
                            {index + 1}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="glass rounded-3xl p-6 space-y-6 sticky top-6">
                    <div className="flex items-center gap-2 text-stone-800 font-semibold">
                      <Settings size={20} />
                      <h3>Calibrazione Voce</h3>
                    </div>

                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-2">
                        <button 
                          onClick={() => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, voiceName: 'Kore', emotion: 'dolce e rassicurante', speed: 0.9, pitch: 1.0}} : null)}
                          className="text-[10px] px-2 py-1 bg-pink-100 text-pink-700 rounded-full font-bold uppercase"
                        >
                          Fiaba
                        </button>
                        <button 
                          onClick={() => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, voiceName: 'Fenrir', emotion: 'profonda, cupa e molto misteriosa', speed: 0.8, pitch: 0.9}} : null)}
                          className="text-[10px] px-2 py-1 bg-indigo-100 text-indigo-700 rounded-full font-bold uppercase"
                        >
                          Dark Fantasy
                        </button>
                        <button 
                          onClick={() => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, voiceName: 'Charon', emotion: 'solenne, antica e oscura', speed: 0.7, pitch: 0.8}} : null)}
                          className="text-[10px] px-2 py-1 bg-stone-800 text-stone-100 rounded-full font-bold uppercase"
                        >
                          Gothic
                        </button>
                        <button 
                          onClick={() => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, voiceName: 'Charon', emotion: 'misteriosa, sussurrata e profonda', speed: 0.85, pitch: 0.85}} : null)}
                          className="text-[10px] px-2 py-1 bg-purple-100 text-purple-700 rounded-full font-bold uppercase"
                        >
                          Mistero
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest">Narratore</label>
                          <button 
                            onClick={handlePreviewVoice}
                            disabled={isGenerating}
                            className="text-[10px] flex items-center gap-1 text-amber-600 font-bold hover:underline disabled:opacity-50"
                          >
                            <Play size={10} fill="currentColor" />
                            Ascolta Anteprima
                          </button>
                        </div>
                        <select 
                          value={editingStory?.voiceConfig.voiceName}
                          onChange={(e) => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, voiceName: e.target.value as any}} : null)}
                          className="w-full bg-stone-50 border-none rounded-xl p-3 text-sm md:text-base focus:ring-2 focus:ring-amber-500 font-medium"
                        >
                          <option value="Kore">Kore (Elsa - Dolce/Narrativa)</option>
                          <option value="Isabella">Isabella (Online - Naturale)</option>
                          <option value="Zeus">Zeus (Uomo Anziano - Profonda)</option>
                          <option value="Gianni">Gianni (Uomo - Profonda)</option>
                          <option value="Diego">Diego (Energica/Fiaba)</option>
                          <option value="Puck">Puck (Calmo/Mistero)</option>
                          <option value="Zephyr">Zephyr (Sottile/Vento)</option>
                        </select>
                      </div>

                      <div className="space-y-4 pt-2">
                        <div className="flex justify-between text-[11px] font-bold text-stone-400 uppercase">
                          <span>Velocità: {editingStory?.voiceConfig.speed.toFixed(1)}x</span>
                          <span>Tono (Pitch): {editingStory?.voiceConfig.pitch.toFixed(1)}x</span>
                        </div>
                        <div className="flex gap-4">
                          <input 
                            type="range" min="0.5" max="2" step="0.1" 
                            value={editingStory?.voiceConfig.speed}
                            onChange={(e) => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, speed: parseFloat(e.target.value)}} : null)}
                            className="flex-1 accent-amber-500"
                          />
                          <input 
                            type="range" min="0" max="2" step="0.1" 
                            value={editingStory?.voiceConfig.pitch}
                            onChange={(e) => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, pitch: parseFloat(e.target.value)}} : null)}
                            className="flex-1 accent-amber-500"
                          />
                        </div>
                      </div>

                      <div className="flex gap-3 pt-4">
                        <button 
                          onClick={handlePreviewVoice}
                          disabled={isGenerating}
                          className="flex-1 bg-stone-100 text-stone-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-stone-200 transition-all border border-stone-200"
                        >
                          <Volume2 size={18} />
                          Prova Voce
                        </button>
                        <button 
                          onClick={() => {
                            if (editingStory) {
                              const storyToSave = { ...editingStory, uid: user?.uid };
                              setDoc(doc(db, 'stories', editingStory.id), storyToSave)
                                .then(() => {
                                  setLastSaved(new Date());
                                  alert("Configurazione voce salvata per questo libro!");
                                });
                            }
                          }}
                          className="flex-1 bg-amber-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-amber-600 transition-all shadow-md shadow-amber-200"
                        >
                          <Save size={18} />
                          Salva Libro
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4 pt-2">
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-stone-400 uppercase">
                            <span>Velocità</span>
                            <span>{editingStory?.voiceConfig.speed}x</span>
                          </div>
                          <input 
                            type="range" min="0.5" max="2.0" step="0.1"
                            value={editingStory?.voiceConfig.speed}
                            onChange={(e) => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, speed: parseFloat(e.target.value)}} : null)}
                            className="w-full h-1.5 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-bold text-stone-400 uppercase">
                            <span>Pitch</span>
                            <span>{editingStory?.voiceConfig.pitch}</span>
                          </div>
                          <input 
                            type="range" min="0.5" max="1.5" step="0.1"
                            value={editingStory?.voiceConfig.pitch}
                            onChange={(e) => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, pitch: parseFloat(e.target.value)}} : null)}
                            className="w-full h-1.5 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-stone-400 uppercase">Emozione / Tono</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {[
                            { label: '😊 Allegra', value: 'allegra, vivace e piena di gioia' },
                            { label: '😢 Triste', value: 'triste, malinconica e sommessa' },
                            { label: '😨 Spaventata', value: 'spaventata, tremante e ansiosa' },
                            { label: '😲 Sorpresa', value: 'sorpresa, eccitata e incredula' },
                            { label: '🕵️ Misteriosa', value: 'misteriosa, sussurrata e profonda' },
                            { label: '😡 Arrabbiata', value: 'arrabbiata, dura e decisa' }
                          ].map((preset) => (
                            <button
                              key={preset.label}
                              onClick={() => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, emotion: preset.value}} : null)}
                              className={`text-[9px] px-2 py-1 rounded-lg font-bold transition-all ${
                                editingStory?.voiceConfig.emotion === preset.value 
                                  ? 'bg-amber-500 text-white shadow-sm' 
                                  : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <input 
                          type="text"
                          value={editingStory?.voiceConfig.emotion}
                          onChange={(e) => setEditingStory(s => s ? {...s, voiceConfig: {...s.voiceConfig, emotion: e.target.value}} : null)}
                          placeholder="es. dolce, misteriosa, allegra"
                          className="w-full bg-stone-50 border-none rounded-xl p-3 focus:ring-2 focus:ring-amber-500 text-sm"
                        />
                      </div>

                      <div className="bg-stone-900/5 p-4 rounded-2xl space-y-2">
                        <div className="flex items-center gap-2 text-[10px] font-bold text-stone-500 uppercase">
                          <Sparkles size={12} />
                          <span>Guida SSML</span>
                        </div>
                        <div className="text-[10px] text-stone-600 space-y-1 leading-tight">
                          <p>• <code className="bg-white px-1">{"<break time=\"1s\"/>"}</code> : Pausa</p>
                          <p>• <code className="bg-white px-1">{"<prosody rate=\"slow\">"}</code> : Lento</p>
                          <p>• <code className="bg-white px-1">{"<emphasis>"}</code> : Enfasi</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {showPreview && editingStory && (
                  <div className="lg:col-span-1">
                    <div className="sticky top-6 space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                          <Sparkles size={16} className="text-amber-500" />
                          Anteprima Live
                        </h3>
                        <div className="flex gap-1">
                          {editingStory.pages.map((_, idx) => (
                            <button
                              key={idx}
                              onClick={() => setPreviewPageIndex(idx)}
                              className={`w-6 h-6 rounded-full text-[10px] font-bold transition-all ${previewPageIndex === idx ? 'bg-amber-500 text-white' : 'bg-stone-200 text-stone-500 hover:bg-stone-300'}`}
                            >
                              {idx + 1}
                            </button>
                          ))}
                        </div>
                      </div>
                      <LivePreview 
                        page={editingStory.pages[previewPageIndex]} 
                        storyTitle={editingStory.title} 
                        pageNumber={previewPageIndex + 1} 
                        totalPages={editingStory.pages.length} 
                      />
                      <div className="bg-amber-50 border border-amber-100 p-4 rounded-2xl">
                        <p className="text-[10px] text-amber-700 leading-relaxed">
                          <strong>Suggerimento:</strong> Questa è un'anteprima in tempo reale. Qualsiasi modifica apportata al testo o ai media qui a sinistra verrà riflessa immediatamente nell'anteprima.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="reader"
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              className="fixed inset-0 bg-black z-50 flex flex-col"
            >
              <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10 bg-gradient-to-b from-black/60 to-transparent">
                <button 
                  onClick={() => setCurrentView('dashboard')}
                  className="text-white/80 hover:text-white flex items-center gap-2 transition-colors"
                >
                  <ChevronLeft size={24} />
                  Dashboard
                </button>
                {user && (
                  <button 
                    onClick={() => setShowSecurityModal(true)}
                    className="p-2 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                    title="Sicurezza & Logout Master"
                  >
                    <Settings size={20} />
                  </button>
                )}
                {user ? (
                  <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setShowText(!showText)}
                    className="text-white/80 hover:text-white p-2 rounded-full bg-white/10 backdrop-blur-sm transition-all"
                    title={showText ? "Nascondi Testo" : "Mostra Testo"}
                  >
                    {showText ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                  <button 
                    onClick={() => readingStory && handlePlayPage(readingStory.pages[currentPageIndex], readingStory.voiceConfig)}
                    disabled={isGenerating || !readingStory}
                    className="bg-amber-500 text-white p-3 rounded-full shadow-lg hover:scale-110 transition-transform disabled:opacity-50"
                  >
                    {isGenerating ? <Music className="animate-pulse" size={24} /> : <Volume2 size={24} />}
                  </button>
                </div>
                ) : null}
              </div>

              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                <AnimatePresence mode="popLayout" custom={direction}>
                  <motion.div 
                    key={currentPageIndex}
                    custom={direction}
                    variants={{
                      enter: (direction: number) => ({
                        x: direction > 0 ? '100%' : '-100%',
                        opacity: 0
                      }),
                      center: {
                        zIndex: 1,
                        x: 0,
                        opacity: 1
                      },
                      exit: (direction: number) => ({
                        zIndex: 0,
                        x: direction < 0 ? '100%' : '-100%',
                        opacity: 0
                      })
                    }}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      x: { type: "spring", stiffness: 300, damping: 30 },
                      opacity: { duration: 0.5 }
                    }}
                    className="absolute inset-0"
                  >
                    <AnimatePresence mode="wait">
                      <motion.div 
                        key={`${currentPageIndex}-${currentMediaIndex}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1 }}
                        className="absolute inset-0"
                      >
                        {readingStory?.pages[currentPageIndex]?.media?.[currentMediaIndex]?.url ? (
                          <SmartMedia 
                            url={readingStory.pages[currentPageIndex].media[currentMediaIndex].url}
                            type={readingStory.pages[currentPageIndex].media[currentMediaIndex].type}
                            className="w-full h-full"
                            muted 
                            loop 
                            playsInline 
                            autoPlay 
                            alt="Scena"
                          />
                        ) : (
                          <div className="w-full h-full bg-stone-900 flex items-center justify-center text-stone-700">
                            <ImageIcon size={120} />
                          </div>
                        )}
                      </motion.div>
                    </AnimatePresence>

                    <AnimatePresence>
                      {showText && (
                        <motion.div 
                          initial={{ opacity: 0, y: 50 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 50 }}
                          className="absolute bottom-0 left-0 right-0 p-12 bg-gradient-to-t from-black/80 via-black/40 to-transparent z-10"
                        >
                          <div className="max-w-4xl mx-auto">
                            <h2 className="text-white/60 text-sm font-bold uppercase tracking-widest mb-4">
                              {readingStory?.title} — Pagina {currentPageIndex + 1} di {readingStory?.pages?.length || 0}
                            </h2>
                            <p className="text-white text-2xl md:text-3xl font-serif leading-relaxed italic">
                              {readingStory?.pages?.[currentPageIndex]?.text}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="absolute top-1/2 left-2 md:left-4 -translate-y-1/2 z-20">
                <button 
                  onClick={() => {
                    setDirection(-1);
                    setCurrentPageIndex(prev => Math.max(0, prev - 1));
                    setCurrentMediaIndex(0);
                  }}
                  disabled={currentPageIndex === 0}
                  className="p-3 md:p-4 rounded-full bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 transition-all disabled:opacity-0"
                >
                  <ChevronLeft className="w-6 h-6 md:w-8 md:h-8" />
                </button>
              </div>

              <div className="absolute top-1/2 right-2 md:right-4 -translate-y-1/2 z-20">
                <button 
                  onClick={() => {
                    if (readingStory) {
                      setDirection(1);
                      setCurrentPageIndex(prev => Math.min(readingStory.pages.length - 1, prev + 1));
                      setCurrentMediaIndex(0);
                    }
                  }}
                  disabled={!readingStory || currentPageIndex === readingStory.pages.length - 1}
                  className="p-3 md:p-4 rounded-full bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 transition-all disabled:opacity-0"
                >
                  <ChevronRight className="w-6 h-6 md:w-8 md:h-8" />
                </button>
              </div>

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 z-20">
                {readingStory?.pages?.map((_, i) => (
                  <button 
                    key={i}
                    onClick={() => {
                      setDirection(i > currentPageIndex ? 1 : -1);
                      setCurrentPageIndex(i);
                      setCurrentMediaIndex(0);
                    }}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === currentPageIndex ? 'w-8 bg-amber-500' : 'w-2 bg-white/30 hover:bg-white/50'}`}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {currentView !== 'reader' && (
        <div className="fixed bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-200 via-amber-500 to-amber-200 opacity-20" />
      )}

      <AnimatePresence>
        {aiImagePromptModal && (
          <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[2rem] md:rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-stone-100"
            >
              <div className="p-6 md:p-8 space-y-4 md:space-y-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <h3 className="text-xl md:text-2xl font-serif font-bold text-stone-900">Genera Illustrazione</h3>
                    <p className="text-xs md:text-sm text-stone-500">Personalizza il prompt per l'IA o usa il suggerimento.</p>
                  </div>
                  <button 
                    onClick={() => setAiImagePromptModal(null)}
                    className="p-2 hover:bg-stone-100 rounded-full transition-colors"
                  >
                    <X size={20} className="text-stone-400" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Prompt per l'IA</label>
                    <textarea 
                      rows={4}
                      value={aiImagePromptModal.prompt}
                      onChange={(e) => setAiImagePromptModal({...aiImagePromptModal, prompt: e.target.value})}
                      className="w-full bg-stone-50 border-none rounded-2xl p-4 text-xs md:text-sm leading-relaxed focus:ring-2 focus:ring-amber-500 resize-none"
                      placeholder="Descrivi l'immagine che desideri..."
                    />
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={() => setAiImagePromptModal(null)}
                      className="flex-1 px-4 md:px-6 py-2.5 md:py-3 rounded-full font-bold text-stone-600 hover:bg-stone-100 transition-all text-xs md:text-sm"
                    >
                      Annulla
                    </button>
                    <button 
                      onClick={() => {
                        generateAIImage(aiImagePromptModal.pageIndex, aiImagePromptModal.mediaIndex, aiImagePromptModal.prompt);
                        setAiImagePromptModal(null);
                      }}
                      className="flex-1 bg-amber-500 text-white px-4 md:px-6 py-2.5 md:py-3 rounded-full font-bold hover:bg-amber-600 transition-all shadow-lg flex items-center justify-center gap-2 text-xs md:text-sm"
                    >
                      <Wand2 className="w-4 h-4 md:w-[18px] md:h-[18px]" />
                      Genera Ora
                    </button>
                  </div>
                </div>
              </div>
              <div className="bg-amber-50 p-3 md:p-4 text-center">
                <p className="text-[9px] md:text-[10px] text-amber-700 font-medium">
                  L'immagine generata sostituirà l'elemento multimediale corrente.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSetupModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
                  <Settings className="text-amber-500" />
                  Voice Setup
                </h3>
                <button onClick={() => setShowSetupModal(false)} className="p-2 hover:bg-stone-100 rounded-full">
                  <X />
                </button>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-sm font-bold text-stone-600">Voce Predefinita del Narratore</label>
                  <select 
                    value={globalVoiceConfig.voiceName}
                    onChange={(e) => setGlobalVoiceConfig(prev => ({...prev, voiceName: e.target.value as any}))}
                    className="w-full bg-stone-100 p-3 rounded-xl border-none focus:ring-2 focus:ring-amber-500 font-medium"
                  >
                    <option value="Kore">Kore (Donna - Elsa)</option>
                    <option value="Isabella">Isabella (Neural - Narrativa)</option>
                    <option value="Zeus">Zeus (Uomo Anziano - Zeus)</option>
                    <option value="Gianni">Gianni (Uomo - Profonda)</option>
                  </select>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between text-xs font-bold text-stone-400">
                    <span>Velocità predefinita</span>
                    <span className="text-amber-500">{globalVoiceConfig.speed.toFixed(1)}x</span>
                  </div>
                  <input 
                    type="range" min="0.5" max="1.5" step="0.1"
                    value={globalVoiceConfig.speed}
                    onChange={(e) => setGlobalVoiceConfig(prev => ({...prev, speed: parseFloat(e.target.value)}))}
                    className="w-full accent-amber-500"
                  />
                </div>

                <button 
                  onClick={() => saveGlobalConfig(globalVoiceConfig)}
                  className="w-full bg-stone-800 text-white font-bold py-4 rounded-2xl hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg"
                >
                  <Save size={18} />
                  Salva Impostazioni Globali
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSecurityModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
                  <Settings className="text-red-500" />
                  Security Center
                </h3>
                <button onClick={() => setShowSecurityModal(false)} className="p-2 hover:bg-stone-100 rounded-full">
                  <X />
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-red-50 rounded-2xl border border-red-100">
                  <p className="text-sm text-red-700 font-medium">Controllo Accessi & Master Logout</p>
                  <p className="text-xs text-red-600 mt-1">Questa operazione disconnetterà l'account e pulirà tutti i dati locali (cache, IndexedDB).</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold text-stone-600">Codice Segreto per Reset Totale</label>
                  <input 
                    type="password"
                    value={securitySecret}
                    onChange={(e) => setSecuritySecret(e.target.value)}
                    placeholder="Inserisci il secret..."
                    className="w-full bg-stone-100 p-3 rounded-xl border-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <button 
                  onClick={handleSecretLogoutAll}
                  className="w-full bg-red-600 text-white font-bold py-3 rounded-xl hover:bg-red-700 transition-all flex items-center justify-center gap-2"
                >
                  <LogOut size={18} />
                  Chiudi Tutte le Sessioni
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}

export default App;
