/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Copy, 
  Download, 
  Moon, 
  Sun, 
  Sparkles, 
  BookOpen, 
  PenTool, 
  Globe, 
  Trash2, 
  Check,
  Loader2,
  ChevronRight,
  History,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import { cn } from './lib/utils';
import { AuthProvider, useAuth } from './AuthContext';
import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  limit, 
  doc, 
  setDoc, 
  deleteDoc,
  getDocFromServer
} from 'firebase/firestore';

// Types
type AIMode = 'summarize' | 'explain' | 'improve' | 'simplify';

interface HistoryItem {
  id: string;
  uid: string;
  timestamp: number;
  mode: AIMode;
  input: string;
  output: string;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

const MODES: { id: AIMode; label: string; icon: React.ReactNode; description: string }[] = [
  { 
    id: 'summarize', 
    label: 'Summarize', 
    icon: <Sparkles className="w-4 h-4" />, 
    description: 'Condense long text into key points' 
  },
  { 
    id: 'explain', 
    label: 'Explain', 
    icon: <BookOpen className="w-4 h-4" />, 
    description: 'Make complex topics easy to understand' 
  },
  { 
    id: 'improve', 
    label: 'Improve', 
    icon: <PenTool className="w-4 h-4" />, 
    description: 'Enhance grammar, flow, and clarity' 
  },
  { 
    id: 'simplify', 
    label: 'Simplify', 
    icon: <Globe className="w-4 h-4" />, 
    description: 'Rewrite in simple, clear English' 
  },
];

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, auth: any) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map((provider: any) => ({
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

function Assistant() {
  const { user, logout } = useAuth();
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [mode, setMode] = useState<AIMode>('summarize');
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Initialize Speech
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;
        recognitionRef.current.lang = 'en-US';
        
        recognitionRef.current.onresult = (event: any) => {
          let finalTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            }
          }
          if (finalTranscript) {
            setInput(prev => prev + (prev ? ' ' : '') + finalTranscript);
          }
        };

        recognitionRef.current.onstart = () => setIsListening(true);
        recognitionRef.current.onend = () => setIsListening(false);
        recognitionRef.current.onerror = (event: any) => {
          console.error('Speech recognition error', event.error);
          setIsListening(false);
          if (event.error === 'not-allowed') {
            alert('Microphone access was denied. Please check your browser settings and ensure the app has permission.');
          }
        };
      } else {
        setSpeechSupported(false);
      }
      synthRef.current = window.speechSynthesis;
    }

    // Check dark mode preference
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setIsDarkMode(true);
    }
  }, []);

  // Sync History with Firestore
  useEffect(() => {
    if (!user) return;

    const historyRef = collection(db, 'users', user.uid, 'history');
    const q = query(historyRef, orderBy('timestamp', 'desc'), limit(20));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items: HistoryItem[] = [];
      snapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as HistoryItem);
      });
      setHistory(items);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/history`, { currentUser: user });
    });

    return unsubscribe;
  }, [user]);

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

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const toggleSpeaking = () => {
    if (isSpeaking) {
      synthRef.current?.cancel();
      setIsSpeaking(false);
    } else if (output) {
      const utterance = new SpeechSynthesisUtterance(output.replace(/[#*`]/g, ''));
      utterance.onend = () => setIsSpeaking(false);
      synthRef.current?.speak(utterance);
      setIsSpeaking(true);
    }
  };

  const handleGenerate = async () => {
    if (!input.trim() || !user) return;

    setIsLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: input,
        config: {
          systemInstruction: getSystemInstruction(mode),
        }
      });

      const response = await model;
      const text = response.text || "Sorry, I couldn't process that.";
      setOutput(text);

      // Add to Firestore
      const historyRef = collection(db, 'users', user.uid, 'history');
      const docId = Math.random().toString(36).substring(7);
      const newItem = {
        id: docId,
        uid: user.uid,
        timestamp: Date.now(),
        mode,
        input,
        output: text
      };
      
      try {
        await setDoc(doc(historyRef, docId), newItem);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/history/${docId}`, { currentUser: user });
      }

    } catch (error) {
      console.error("AI Error:", error);
      setOutput("An error occurred while generating. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const getSystemInstruction = (mode: AIMode) => {
    switch (mode) {
      case 'summarize':
        return "You are a helpful assistant that summarizes text. Provide a concise summary with key bullet points. Focus on the most important information.";
      case 'explain':
        return "You are a helpful assistant that explains complex topics. Use simple analogies and clear language. Break down difficult concepts as if explaining to a curious student.";
      case 'improve':
        return "You are a helpful assistant that improves writing. Fix grammar, enhance vocabulary, and improve the overall flow and clarity while maintaining the original meaning.";
      case 'simplify':
        return "You are a helpful assistant that simplifies language. Rewrite the text using only common words and short sentences. Aim for a 5th-grade reading level.";
      default:
        return "You are a helpful assistant.";
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadResult = () => {
    const element = document.createElement("a");
    const file = new Blob([output], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = `readease_${mode}_${new Date().getTime()}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const clearAll = () => {
    setInput('');
    setOutput('');
  };

  const wordCount = input.trim() ? input.trim().split(/\s+/).length : 0;
  const charCount = input.length;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 glass px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/20">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="font-display font-bold text-xl tracking-tight">ReadEase</h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">AI Virtual Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400"
            title="History"
          >
            <History className="w-5 h-5" />
          </button>
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400"
          >
            {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <div className="h-6 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />
          <div className="flex items-center gap-2 pl-2">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-800" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <UserIcon className="w-4 h-4 text-slate-500" />
              </div>
            )}
            <button 
              onClick={logout}
              className="p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors text-slate-500 hover:text-red-500"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Input & Controls */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-lg">Input Text</h2>
              <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                <span>{wordCount} words</span>
                <span>•</span>
                <span>{charCount} chars</span>
              </div>
            </div>
            
            <div className="relative group">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Paste your text here or use the microphone..."
                className="w-full h-64 p-6 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none transition-all resize-none font-sans text-base leading-relaxed"
              />
              <div className="absolute bottom-4 right-4 flex items-center gap-2">
                <button 
                  onClick={clearAll}
                  className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors text-slate-400 hover:text-red-500"
                  title="Clear all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => {
                    if (!speechSupported) {
                      alert('Speech recognition is not supported in this browser. Please try Chrome or Edge.');
                      return;
                    }
                    toggleListening();
                  }}
                  className={cn(
                    "p-3 rounded-xl transition-all shadow-lg",
                    isListening 
                      ? "bg-red-500 text-white animate-pulse" 
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50",
                    !speechSupported && "opacity-50 cursor-not-allowed"
                  )}
                  title={speechSupported ? (isListening ? "Stop listening" : "Start listening") : "Speech not supported"}
                >
                  {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="font-display font-semibold text-lg">Choose Mode</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all text-center group",
                    mode === m.id 
                      ? "bg-brand-50 border-brand-200 dark:bg-brand-900/20 dark:border-brand-800 text-brand-600 dark:text-brand-400" 
                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-300 dark:hover:border-slate-700"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                    mode === m.id ? "bg-brand-500 text-white" : "bg-slate-100 dark:bg-slate-800 group-hover:bg-slate-200"
                  )}>
                    {m.icon}
                  </div>
                  <span className="text-xs font-semibold">{m.label}</span>
                </button>
              ))}
            </div>
          </section>

          <button
            onClick={handleGenerate}
            disabled={isLoading || !input.trim()}
            className="w-full py-4 bg-brand-500 hover:bg-brand-600 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-2xl font-display font-bold text-lg shadow-xl shadow-brand-500/20 transition-all flex items-center justify-center gap-3 group"
          >
            {isLoading ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                Generate {MODES.find(m => m.id === mode)?.label}
                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </button>
        </div>

        {/* Right Column: Output */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-lg">AI Result</h2>
            <div className="flex items-center gap-1">
              <button 
                onClick={copyToClipboard}
                disabled={!output}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500 disabled:opacity-30"
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
              <button 
                onClick={downloadResult}
                disabled={!output}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500 disabled:opacity-30"
                title="Download as text"
              >
                <Download className="w-4 h-4" />
              </button>
              <button 
                onClick={toggleSpeaking}
                disabled={!output}
                className={cn(
                  "p-2 rounded-lg transition-colors disabled:opacity-30",
                  isSpeaking ? "text-brand-500 bg-brand-50 dark:bg-brand-900/20" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
                title="Listen to result"
              >
                {isSpeaking ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-[400px] p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm overflow-y-auto relative">
            <AnimatePresence mode="wait">
              {output ? (
                <motion.div
                  key="output"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="markdown-body"
                >
                  <Markdown>{output}</Markdown>
                </motion.div>
              ) : (
                <motion.div
                  key="placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="h-full flex flex-col items-center justify-center text-center gap-4 text-slate-400"
                >
                  <div className="w-16 h-16 rounded-full bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                    <Sparkles className="w-8 h-8 opacity-20" />
                  </div>
                  <p className="text-sm max-w-[200px]">
                    Your AI-generated content will appear here...
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* History Sidebar */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-white dark:bg-slate-950 shadow-2xl z-[70] p-6 flex flex-col gap-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-xl">History</h2>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto flex flex-col gap-4">
                {history.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center gap-2">
                    <History className="w-8 h-8 opacity-20" />
                    <p className="text-sm">No history yet</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setInput(item.input);
                        setOutput(item.output);
                        setMode(item.mode);
                        setShowHistory(false);
                      }}
                      className="text-left p-4 rounded-2xl border border-slate-100 dark:border-slate-800 hover:border-brand-200 dark:hover:border-brand-900 transition-all hover:shadow-md group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-brand-500">{item.mode}</span>
                        <span className="text-[10px] text-slate-400">{new Date(item.timestamp).toLocaleDateString()}</span>
                      </div>
                      <p className="text-sm font-medium line-clamp-2 text-slate-700 dark:text-slate-300 group-hover:text-brand-600">
                        {item.input}
                      </p>
                    </button>
                  ))
                )}
              </div>

              {history.length > 0 && (
                <button 
                  onClick={async () => {
                    if (!user) return;
                    const historyRef = collection(db, 'users', user.uid, 'history');
                    // In a real app, you'd batch delete or use a cloud function
                    // For now, we'll just clear the local state and the user can delete individually or we can implement a simple loop
                    for (const item of history) {
                      await deleteDoc(doc(historyRef, item.id));
                    }
                  }}
                  className="w-full py-3 text-red-500 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-colors"
                >
                  Clear History
                </button>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="px-6 py-4 border-t border-slate-100 dark:border-slate-900 text-center">
        <p className="text-xs text-slate-400">
          MADE WITH <span className="text-red-500">❤</span> BY MAHI AND SUNEETI | Powered by Google Gemini API & Firebase
        </p>
      </footer>
    </div>
  );
}

function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await loginWithGoogle();
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col items-center text-center gap-8"
      >
        <div className="w-16 h-16 bg-brand-500 rounded-2xl flex items-center justify-center shadow-xl shadow-brand-500/20">
          <Sparkles className="text-white w-10 h-10" />
        </div>
        
        <div>
          <h1 className="font-display font-bold text-3xl tracking-tight mb-2">Welcome to ReadEase</h1>
          <p className="text-slate-500 dark:text-slate-400">Your quiet companion for noisy minds. Sign in to sync your history and settings.</p>
        </div>

        <button
          onClick={handleLogin}
          disabled={isLoggingIn}
          className="w-full py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-semibold flex items-center justify-center gap-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all shadow-sm"
        >
          {isLoggingIn ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              Continue with Google
            </>
          )}
        </button>

        <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
          Secure Authentication by Firebase
        </p>
      </motion.div>
    </div>
  );
}

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
      </div>
    );
  }

  return user ? <Assistant /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
