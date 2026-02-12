import { useState, useEffect, useRef } from 'react'
import { TelestackClient } from '@telestack/db-sdk'
import { Send, User, Users, Hash } from 'lucide-react'

// Generate or get a random user ID for the session
const SESSION_USER_ID = localStorage.getItem('chat_user_id') || `user_${Math.random().toString(36).substring(7)}`;
localStorage.setItem('chat_user_id', SESSION_USER_ID);

export default function App() {
  const [messages, setMessages] = useState<any[]>([])
  const [inputText, setInputText] = useState('')
  const [presenceCount, setPresenceCount] = useState(0)
  const [isDbReady, setIsDbReady] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Initialize Telestack Client (pointing to production by default in v1.0.1)
  const [db] = useState(() => new TelestackClient({
    userId: SESSION_USER_ID,
    workspaceId: 'telestack-public-demo'
  }));

  useEffect(() => {
    // 1. Subscribe to real-time messages
    const unsubscribe = db.collection('messages')
      .orderBy('created_at', 'asc')
      .onSnapshot((docs: any[]) => {
        setMessages(docs);
        setIsDbReady(true);
      });

    // 2. Initial presence check
    const checkPresence = async () => {
      try {
        const stats = await db.getPresenceStats('collection:messages');
        setPresenceCount(stats.numUsers);
      } catch (e) {
        console.warn("Presence check failed", e);
      }
    };
    checkPresence();

    // 3. Listen for presence changes
    db.collection('messages').onPresence(() => {
      checkPresence();
    });

    return () => unsubscribe();
  }, [db]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText;
    setInputText('');

    try {
      await db.collection('messages').add({
        text,
        sender: SESSION_USER_ID,
        timestamp: new Date().toISOString() // Server-side trigger will eventually overwrite with DB timestamp
      });
    } catch (e) {
      console.error("Failed to send message", e);
      alert("Auth Denied: Check Security Rules!");
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#1a1a1a] text-white font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 bg-[#252525] border-b border-white/10 shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-500 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(234,179,8,0.3)]">
            <Hash className="w-6 h-6 text-black font-bold" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Public Lobby</h1>
            <p className="text-[10px] text-yellow-500 font-mono uppercase tracking-widest">Powered by Telestack DB</p>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-black/30 px-4 py-2 rounded-full border border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
            <span className="text-sm font-medium text-white/90">{presenceCount} Online</span>
          </div>
          <div className="w-px h-4 bg-white/10" />
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-white/50" />
            <span className="text-sm text-white/50 truncate max-w-[100px]">{SESSION_USER_ID}</span>
          </div>
        </div>
      </header>

      {/* Message Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#1e1e1e] to-[#1a1a1a]"
      >
        {!isDbReady ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 opacity-50">
            <div className="w-8 h-8 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono uppercase tracking-widest text-yellow-500">Connecting to Edge...</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 opacity-20">
            <Users className="w-16 h-16" />
            <p className="text-lg italic">No messages yet. Be the first!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.data.sender === SESSION_USER_ID;
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2 duration-300`}
              >
                <div className="flex items-center gap-2 mb-1 px-1">
                  {!isMe && <span className="text-[10px] font-bold text-yellow-500/70 uppercase tracking-tighter">{msg.data.sender}</span>}
                  <span className="text-[9px] text-white/30">{new Date(msg.created_at).toLocaleTimeString()}</span>
                </div>
                <div className={`max-w-[80%] px-4 py-3 rounded-2xl shadow-md ${isMe
                  ? 'bg-yellow-500 text-black font-medium rounded-tr-none'
                  : 'bg-[#333] text-white rounded-tl-none border border-white/5'
                  }`}>
                  {msg.data.text}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Input Area */}
      <div className="p-6 bg-[#252525] border-t border-white/10 shrink-0">
        <form onSubmit={sendMessage} className="relative max-w-4xl mx-auto">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your message..."
            className="w-full bg-[#1a1a1a] border border-white/10 rounded-2xl py-4 pl-6 pr-16 text-lg outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/50 transition-all placeholder:text-white/20"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="absolute right-2 top-2 bottom-2 px-4 bg-yellow-500 text-black rounded-xl hover:bg-yellow-400 disabled:opacity-30 disabled:hover:bg-yellow-500 transition-all flex items-center justify-center shadow-lg active:scale-95"
          >
            <Send className="w-6 h-6" />
          </button>
        </form>
        <p className="text-center text-[10px] text-white/20 mt-4 uppercase tracking-[0.2em]">
          Global Edge Network | 15ms Latency
        </p>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}} />
    </div>
  )
}
