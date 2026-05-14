import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { 
  getAuth, signInAnonymously, signInWithCustomToken, 
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut 
} from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, doc, setDoc, updateDoc, 
  deleteDoc, addDoc, serverTimestamp, getDoc 
} from 'firebase/firestore';
import { 
  Plus, CheckCircle2, Circle, Trash2, Share2, Menu, X, 
  Users, Copy, List as ListIcon, LogOut, Check, UserPlus,
  ChevronDown, ChevronRight, AlignLeft, Bold, Italic, Calendar
} from 'lucide-react';

// --- FOOLPROOF STYLING FALLBACK ---
if (typeof window !== 'undefined' && !document.getElementById('tailwind-cdn')) {
  const script = document.createElement('script');
  script.id = 'tailwind-cdn';
  script.src = 'https://cdn.tailwindcss.com';
  document.head.appendChild(script);
}
// ----------------------------------

// 1. Safely Initialize Firebase outside the component
let app, auth, db, analytics;
let appId = 'default-app-id';
let firebaseInitError = null;

try {
  if (typeof __firebase_config !== 'undefined' && __firebase_config) {
    // Canvas Environment setup
    const config = JSON.parse(__firebase_config);
    app = initializeApp(config);
    appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
  } else {
    // Local Environment setup (Vite)
    const localConfig = {
      apiKey: "AIzaSyAKp0cZaXEaXlyYvqAQrRPtZS4ZRwdsHz4",
  authDomain: "gvs-tasks.firebaseapp.com",
  projectId: "gvs-tasks",
  storageBucket: "gvs-tasks.firebasestorage.app",
  messagingSenderId: "580522309982",
  appId: "1:580522309982:web:52553952d3652f576577cf",
  measurementId: "G-LC92RRM410"
    };

    if (Object.keys(localConfig).length === 0) {
      throw new Error("Your Firebase configuration is empty.");
    }
    
    app = initializeApp(localConfig);
    appId = 'local-dev-app';

    if (localConfig.measurementId) {
      analytics = getAnalytics(app);
    }
  }
  
  auth = getAuth(app);
  db = getFirestore(app);
} catch (err) {
  console.error("Firebase Initialization Failed:", err);
  firebaseInitError = err.message;
}

export default function App() {
  // State Management
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [lists, setLists] = useState([]);
  const [currentListId, setCurrentListId] = useState(null);
  const [tasks, setTasks] = useState([]);
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newListTitle, setNewListTitle] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [toast, setToast] = useState(null);

  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editingTaskText, setEditingTaskText] = useState('');

  const [expandedTasks, setExpandedTasks] = useState(new Set());
  const [editingDescId, setEditingDescId] = useState(null);
  const [editingDescText, setEditingDescText] = useState('');
  const descInputRef = useRef(null);

  // 2. Auth Initialization
  useEffect(() => {
    if (firebaseInitError || !auth) {
      setAuthLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });

    // Auto-login for Canvas environment only
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
      signInWithCustomToken(auth, __initial_auth_token).catch(err => {
        console.error("Canvas Auth error:", err);
        setAuthLoading(false);
      });
    }

    return () => unsubscribe();
  }, []);

  // Login Handlers
  const loginWithGoogle = async () => {
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google login failed:", error);
      showToast("Sign in with Google failed.", "error");
      setAuthLoading(false);
    }
  };

  const loginAnonymously = async () => {
    setAuthLoading(true);
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error("Anonymous login failed:", error);
      showToast("Anonymous sign in failed.", "error");
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setLists([]);
      setTasks([]);
      setCurrentListId(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  // 3. Fetch Lists
  useEffect(() => {
    if (!user || !db || firebaseInitError) return;
    
    const listsRef = collection(db, 'artifacts', appId, 'public', 'data', 'lists');
    const unsub = onSnapshot(listsRef, (snapshot) => {
      const allLists = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const myLists = allLists.filter(l => 
        l.ownerId === user.uid || 
        (l.editors && l.editors.includes(user.uid)) || 
        (l.viewers && l.viewers.includes(user.uid))
      );
      
      myLists.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
      setLists(myLists);

      if (!currentListId && myLists.length > 0) {
        setCurrentListId(myLists[0].id);
      } else if (currentListId && !myLists.find(l => l.id === currentListId)) {
        setCurrentListId(myLists.length > 0 ? myLists[0].id : null);
      }
    }, (err) => {
      console.error("Error fetching lists:", err);
      showToast("Failed to load lists.", "error");
    });

    return () => unsub();
  }, [user, currentListId]);

  // 4. Fetch Tasks for current list
  useEffect(() => {
    if (!user || !currentListId || !db || firebaseInitError) {
      setTasks([]);
      return;
    }

    const tasksRef = collection(db, 'artifacts', appId, 'public', 'data', `tasks_${currentListId}`);
    const unsub = onSnapshot(tasksRef, (snapshot) => {
      const allTasks = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      
      allTasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
      });
      
      setTasks(allTasks);
    }, (err) => {
      console.error("Error fetching tasks:", err);
    });

    return () => unsub();
  }, [user, currentListId]);

  // Helper: Toast Notifications
  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const currentList = lists.find(l => l.id === currentListId);
  const isOwner = currentList?.ownerId === user?.uid;
  const isEditor = currentList?.editors?.includes(user?.uid);
  const canEdit = currentList && (isOwner || isEditor);

  // Actions
  const createList = async (e) => {
    e.preventDefault();
    if (!newListTitle.trim() || !user || !db) return;

    try {
      const newListRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'lists'));
      await setDoc(newListRef, {
        title: newListTitle.trim(),
        ownerId: user.uid,
        editors: [],
        viewers: [],
        editToken: crypto.randomUUID(),
        viewToken: crypto.randomUUID(),
        createdAt: serverTimestamp()
      });
      setNewListTitle('');
      setCurrentListId(newListRef.id);
      setIsSidebarOpen(false);
      showToast("List created!");
    } catch (err) {
      console.error(err);
      showToast("Error creating list.", "error");
    }
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTaskText.trim() || !canEdit || !user || !db) return;

    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', `tasks_${currentListId}`), {
        text: newTaskText.trim(),
        description: '',
        dueDate: newTaskDueDate || null,
        completed: false,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
      setNewTaskText('');
      setNewTaskDueDate('');
    } catch (err) {
      console.error(err);
      showToast("Error adding task.", "error");
    }
  };

  const toggleTask = async (task) => {
    if (!canEdit || !db) return;
    try {
      const taskRef = doc(db, 'artifacts', appId, 'public', 'data', `tasks_${currentListId}`, task.id);
      await updateDoc(taskRef, { completed: !task.completed });
    } catch (err) {
      console.error(err);
    }
  };

  const deleteTask = async (taskId) => {
    if (!canEdit || !db) return;
    try {
      const taskRef = doc(db, 'artifacts', appId, 'public', 'data', `tasks_${currentListId}`, taskId);
      await deleteDoc(taskRef);
    } catch (err) {
      console.error(err);
      showToast("Error deleting task.", "error");
    }
  };

  const saveEditedTask = async (task) => {
    if (!canEdit || !editingTaskText.trim() || !db) {
      setEditingTaskId(null);
      return;
    }
    try {
      const taskRef = doc(db, 'artifacts', appId, 'public', 'data', `tasks_${currentListId}`, task.id);
      await updateDoc(taskRef, { text: editingTaskText.trim() });
      setEditingTaskId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const updateTaskDueDate = async (taskId, newDate) => {
    if (!canEdit || !db) return;
    try {
      const taskRef = doc(db, 'artifacts', appId, 'public', 'data', `tasks_${currentListId}`, taskId);
      await updateDoc(taskRef, { dueDate: newDate || null });
    } catch (err) {
      console.error(err);
      showToast("Error updating due date.", "error");
    }
  };

  const saveEditedDesc = async (task) => {
    if (!canEdit || !db) return;
    try {
      const taskRef = doc(db, 'artifacts', appId, 'public', 'data', `tasks_${currentListId}`, task.id);
      await updateDoc(taskRef, { description: editingDescText.trim() });
      setEditingDescId(null);
    } catch (err) {
      console.error(err);
      showToast("Error saving description.", "error");
    }
  };

  const toggleExpand = (taskId) => {
    const newSet = new Set(expandedTasks);
    if (newSet.has(taskId)) newSet.delete(taskId);
    else newSet.add(taskId);
    setExpandedTasks(newSet);
  };

  const formatText = (text) => {
    if (!text) return { __html: '<span class="text-gray-400 italic">No description</span>' };
    let html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>');
    return { __html: html };
  };

  const insertFormatting = (prefix, suffix) => {
    const textarea = descInputRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = editingDescText;
    const before = text.substring(0, start);
    const selected = text.substring(start, end);
    const after = text.substring(end);
    
    const newText = before + prefix + selected + suffix + after;
    setEditingDescText(newText);
    
    setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  const deleteCurrentList = async () => {
    if (!isOwner || !db) return;
    try {
      const listRef = doc(db, 'artifacts', appId, 'public', 'data', 'lists', currentListId);
      await deleteDoc(listRef);
      setCurrentListId(null);
      showToast("List deleted.");
    } catch (err) {
      console.error(err);
      showToast("Error deleting list.", "error");
    }
  };

  const generateShareCode = (role) => {
    if (!currentList) return '';
    const token = role === 'edit' ? currentList.editToken : currentList.viewToken;
    const rawString = `${currentList.id}:::${token}:::${role}`;
    return btoa(rawString);
  };

  const copyToClipboard = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("Copy");
      textArea.remove();
      showToast("Code copied to clipboard!");
    } catch (err) {
      showToast("Failed to copy.", "error");
    }
  };

  const handleJoinList = async (e) => {
    e.preventDefault();
    if (!joinCode.trim() || !user || !db) return;

    try {
      const decoded = atob(joinCode.trim());
      const [listId, token, role] = decoded.split(':::');
      
      if (!listId || !token || !role) throw new Error("Invalid code format");

      const listRef = doc(db, 'artifacts', appId, 'public', 'data', 'lists', listId);
      const listSnap = await getDoc(listRef);
      
      if (listSnap.exists()) {
        const listData = listSnap.data();
        
        if (listData.ownerId === user.uid) {
           showToast("You already own this list!");
           setCurrentListId(listId);
           setShowJoinModal(false);
           setJoinCode('');
           return;
        }

        if (role === 'edit' && listData.editToken === token) {
          const newEditors = [...new Set([...(listData.editors || []), user.uid])];
          await updateDoc(listRef, { editors: newEditors });
          showToast(`Joined "${listData.title}" as Editor!`);
          setCurrentListId(listId);
        } else if (role === 'view' && listData.viewToken === token) {
          const newViewers = [...new Set([...(listData.viewers || []), user.uid])];
          await updateDoc(listRef, { viewers: newViewers });
          showToast(`Joined "${listData.title}" as Viewer.`);
          setCurrentListId(listId);
        } else {
          showToast("Invalid code or permission revoked.", "error");
        }
      } else {
        showToast("List not found.", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Invalid sharing code.", "error");
    }
    setShowJoinModal(false);
    setJoinCode('');
  };

  // UI Renders
  if (firebaseInitError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-800 p-4 font-sans">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg w-full text-center border-t-4 border-red-500">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <X size={32} className="text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Firebase Config Missing</h2>
          <p className="text-gray-600 mb-6 text-sm">
            The application couldn't start because the Firebase configuration is empty or invalid. 
          </p>
          <div className="bg-gray-800 text-red-400 text-xs text-left p-4 rounded-md font-mono overflow-auto mb-6">
            Error: {firebaseInitError}
          </div>
          <p className="text-sm text-gray-500 bg-blue-50 p-4 rounded-md text-left">
            <strong>How to fix:</strong><br/> Open your <code>src/App.jsx</code> file, find the <code>localConfig</code> object around line 38, and paste the settings from your Firebase console.
          </p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-800">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  // --- LOGIN SCREEN ---
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-800 p-4 font-sans">
        {toast && (
          <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg z-50 text-white transition-all ${toast.type === 'error' ? 'bg-red-500' : 'bg-gray-800'}`}>
            {toast.message}
          </div>
        )}
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-sm w-full text-center border border-gray-100">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
              <CheckCircle2 size={36} />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Shared Tasks</h2>
          <p className="text-gray-500 mb-8 text-sm">Sign in to save your lists and collaborate from any device.</p>
          
          <div className="space-y-4">
            <button 
              onClick={loginWithGoogle}
              className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 hover:bg-gray-50 hover:shadow-sm text-gray-700 px-4 py-3 rounded-xl font-medium transition-all"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>
            
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-gray-200"></div>
              <span className="flex-shrink-0 mx-4 text-gray-400 text-xs font-medium uppercase tracking-wider">Or</span>
              <div className="flex-grow border-t border-gray-200"></div>
            </div>

            <button 
              onClick={loginAnonymously}
              className="w-full flex items-center justify-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-600 px-4 py-3 border border-gray-200 rounded-xl font-medium transition-colors"
            >
              Continue Anonymously
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white text-gray-800 overflow-hidden font-sans">
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg z-50 text-white transition-all ${toast.type === 'error' ? 'bg-red-500' : 'bg-gray-800'}`}>
          {toast.message}
        </div>
      )}

      {/* Sidebar Overlay for Mobile */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 z-20 md:hidden" 
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 w-72 bg-gray-50 border-r border-gray-200 z-30 transform transition-transform duration-200 ease-in-out flex flex-col
        md:relative md:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-4 flex items-center justify-between border-b border-gray-200">
          <div className="flex items-center space-x-2 text-blue-600 font-semibold text-lg">
            <CheckCircle2 size={24} />
            <span>Tasks</span>
          </div>
          <button className="md:hidden text-gray-500 hover:bg-gray-200 p-1 rounded" onClick={() => setIsSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 px-2 mt-2">Your Lists</div>
          
          {lists.length === 0 ? (
            <div className="px-2 py-4 text-sm text-gray-500 italic">No lists yet.</div>
          ) : (
            lists.map(list => (
              <button
                key={list.id}
                onClick={() => {
                  setCurrentListId(list.id);
                  setIsSidebarOpen(false);
                }}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
                  currentListId === list.id ? 'bg-blue-100 text-blue-700 font-medium' : 'hover:bg-gray-200 text-gray-700'
                }`}
              >
                <ListIcon size={16} />
                <span className="flex-1 truncate">{list.title}</span>
                {list.ownerId !== user?.uid && (
                  <Users size={14} className={currentListId === list.id ? 'text-blue-500' : 'text-gray-400'} />
                )}
              </button>
            ))
          )}

          <form onSubmit={createList} className="mt-4 px-2 flex flex-col space-y-2">
             <input
                type="text"
                placeholder="New list title..."
                value={newListTitle}
                onChange={(e) => setNewListTitle(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
             />
             <button
                type="submit"
                disabled={!newListTitle.trim()}
                className="w-full flex items-center justify-center space-x-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-md text-sm font-medium disabled:opacity-50 transition-colors"
             >
               <Plus size={16} />
               <span>Create List</span>
             </button>
          </form>
        </div>

        <div className="p-4 border-t border-gray-200 space-y-3">
          <button 
            onClick={() => setShowJoinModal(true)}
            className="w-full flex items-center justify-center space-x-2 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-2 rounded-md text-sm font-medium transition-colors"
          >
            <UserPlus size={16} />
            <span>Join Shared List</span>
          </button>
          
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 overflow-hidden">
               {user.photoURL ? (
                 <img src={user.photoURL} alt="Profile" className="w-6 h-6 rounded-full" />
               ) : (
                 <div className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center text-xs text-gray-500">
                   <Users size={12}/>
                 </div>
               )}
               <span className="text-xs font-medium text-gray-600 truncate flex-1">
                 {user.isAnonymous ? 'Anonymous User' : (user.displayName || user.email)}
               </span>
            </div>
            <button 
              onClick={handleLogout} 
              className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors" 
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col relative">
        {/* Header */}
        <header className="h-16 px-4 md:px-8 border-b border-gray-200 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center">
            <button 
              className="mr-4 p-2 text-gray-600 hover:bg-gray-100 rounded-md md:hidden"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={20} />
            </button>
            {currentList ? (
              <h1 className="text-xl font-medium text-gray-800 truncate flex items-center gap-2">
                {currentList.title}
                {!canEdit && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-normal">View Only</span>}
              </h1>
            ) : (
              <h1 className="text-xl font-medium text-gray-400 italic">Select a list</h1>
            )}
          </div>

          {currentList && isOwner && (
            <button
              onClick={() => setShowShareModal(true)}
              className="flex items-center space-x-2 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              <Share2 size={16} />
              <span className="hidden sm:inline">Share</span>
            </button>
          )}
        </header>

        {/* Task List Area */}
        {currentList ? (
          <div className="flex-1 overflow-y-auto bg-white p-4 md:p-8">
            <div className="max-w-3xl mx-auto">
              
              {/* Add Task Input */}
              {canEdit && (
                <form onSubmit={addTask} className="mb-8 flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Plus size={20} className="text-blue-500" />
                    </div>
                    <input
                      type="text"
                      value={newTaskText}
                      onChange={(e) => setNewTaskText(e.target.value)}
                      placeholder="Add a task"
                      className="w-full pl-10 pr-4 py-3 text-lg border-b-2 border-transparent hover:border-gray-200 focus:border-blue-500 bg-gray-50 focus:bg-white rounded-md sm:rounded-r-none outline-none transition-all"
                    />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex items-center bg-gray-50 rounded-md sm:rounded-none sm:rounded-l-none hover:bg-gray-100 border-b-2 border-transparent hover:border-gray-200 focus-within:border-blue-500 focus-within:bg-white transition-all px-3">
                      <Calendar size={18} className="text-gray-400 mr-2" />
                      <input
                        type="date"
                        value={newTaskDueDate}
                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                        className="bg-transparent outline-none text-sm text-gray-600 py-3 cursor-pointer"
                        title="Set due date"
                      />
                    </div>
                    <button 
                      type="submit" 
                      disabled={!newTaskText.trim()}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </form>
              )}

              {/* Tasks List */}
              <div className="space-y-1">
                {tasks.length === 0 ? (
                  <div className="text-center py-10 text-gray-400">
                    {canEdit ? "No tasks yet. Add one above!" : "This list is empty."}
                  </div>
                ) : (
                  tasks.map(task => (
                    <div 
                      key={task.id} 
                      className={`group flex flex-col p-3 hover:bg-gray-50 rounded-lg border border-transparent hover:border-gray-100 transition-colors ${task.completed ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center flex-1 space-x-3 overflow-hidden">
                          <button onClick={() => toggleExpand(task.id)} className="flex-shrink-0 text-gray-400 hover:text-gray-600 focus:outline-none">
                            {expandedTasks.has(task.id) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                          
                          <button 
                            onClick={() => toggleTask(task)}
                            disabled={!canEdit}
                            className={`flex-shrink-0 focus:outline-none ${canEdit ? 'cursor-pointer hover:text-blue-600' : 'cursor-default'} ${task.completed ? 'text-blue-500' : 'text-gray-400'}`}
                          >
                            {task.completed ? <CheckCircle2 size={22} className="text-blue-500" /> : <Circle size={22} />}
                          </button>
                          
                          {editingTaskId === task.id ? (
                            <input
                              type="text"
                              value={editingTaskText}
                              onChange={(e) => setEditingTaskText(e.target.value)}
                              onBlur={() => saveEditedTask(task)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditedTask(task);
                                if (e.key === 'Escape') setEditingTaskId(null);
                              }}
                              autoFocus
                              className="flex-1 text-sm md:text-base outline-none bg-white border-b border-blue-500 px-1 py-0.5"
                            />
                          ) : (
                            <div className="flex-1 flex flex-col sm:flex-row sm:items-center min-w-0">
                              <span 
                                onClick={() => {
                                  if (canEdit && !task.completed) {
                                    setEditingTaskId(task.id);
                                    setEditingTaskText(task.text);
                                  }
                                }}
                                className={`text-sm md:text-base truncate cursor-text ${task.completed ? 'line-through text-gray-500' : 'text-gray-800'}`}
                              >
                                {task.text}
                              </span>
                              
                              {/* Display Due Date Badge */}
                              {task.dueDate && (
                                <span className={`mt-1 sm:mt-0 sm:ml-3 inline-flex items-center w-max gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${
                                  task.completed 
                                    ? 'bg-gray-100 text-gray-500 border-gray-200' 
                                    : 'bg-blue-50 text-blue-700 border-blue-100'
                                }`}>
                                  <Calendar size={12} />
                                  {task.dueDate}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {canEdit && (
                          <button 
                            onClick={() => deleteTask(task.id)}
                            className="flex-shrink-0 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-md hover:bg-red-50 ml-2"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>

                      {/* Expanded Section for Description & Due Date Editor */}
                      {expandedTasks.has(task.id) && (
                        <div className="ml-14 mt-3 pl-3 border-l-2 border-gray-200">
                          
                          {/* Inline Due Date Editor */}
                          {canEdit && !task.completed && (
                            <div className="mb-4 flex items-center gap-2">
                              <Calendar size={14} className="text-gray-400" />
                              <span className="text-xs font-medium text-gray-500">Due:</span>
                              <input 
                                type="date" 
                                value={task.dueDate || ''}
                                onChange={(e) => updateTaskDueDate(task.id, e.target.value)}
                                className="text-xs p-1 border border-gray-300 rounded bg-white text-gray-700 outline-none focus:border-blue-500 cursor-pointer"
                              />
                            </div>
                          )}

                          {editingDescId === task.id ? (
                            <div className="flex flex-col space-y-2 mt-1">
                              <div className="flex space-x-1 bg-gray-100 p-1 rounded-md w-max">
                                <button type="button" onClick={() => insertFormatting('**', '**')} className="p-1.5 hover:bg-gray-200 rounded text-gray-700 transition-colors" title="Bold">
                                  <Bold size={14} />
                                </button>
                                <button type="button" onClick={() => insertFormatting('*', '*')} className="p-1.5 hover:bg-gray-200 rounded text-gray-700 transition-colors" title="Italic">
                                  <Italic size={14} />
                                </button>
                              </div>
                              <textarea
                                ref={descInputRef}
                                value={editingDescText}
                                onChange={(e) => setEditingDescText(e.target.value)}
                                className="w-full min-h-[80px] p-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-blue-500 bg-white"
                                placeholder="Add a description... (Use **bold** and *italic*)"
                              />
                              <div className="flex space-x-2">
                                <button onClick={() => saveEditedDesc(task)} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors">Save Details</button>
                                <button onClick={() => setEditingDescId(null)} className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded-md hover:bg-gray-300 transition-colors">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div 
                              onClick={() => {
                                if (canEdit && !task.completed) {
                                  setEditingDescId(task.id);
                                  setEditingDescText(task.description || '');
                                }
                              }}
                              className={`text-sm text-gray-600 min-h-[24px] flex items-start gap-2 py-1 ${canEdit && !task.completed ? 'cursor-text hover:bg-gray-100 px-2 -ml-2 rounded transition-colors' : ''}`}
                            >
                              <AlignLeft size={16} className="text-gray-400 mt-0.5 shrink-0" />
                              <div 
                                className="break-words w-full space-y-1"
                                dangerouslySetInnerHTML={formatText(task.description)} 
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Delete List Button (Owner Only) */}
              {isOwner && (
                 <div className="mt-12 text-center pb-8">
                    <button 
                      onClick={deleteCurrentList}
                      className="text-xs text-red-500 hover:text-red-700 hover:underline transition-colors"
                    >
                      Delete this list
                    </button>
                 </div>
              )}

            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50">
            <div className="text-center text-gray-400">
              <CheckCircle2 size={48} className="mx-auto mb-4 opacity-20" />
              <p>Select a list or create a new one to get started.</p>
            </div>
          </div>
        )}
      </div>

      {/* Share Modal */}
      {showShareModal && isOwner && currentList && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Share2 size={18} className="text-blue-500"/> Share "{currentList.title}"
              </h2>
              <button onClick={() => setShowShareModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <p className="text-sm text-gray-600">
                Copy an invite code below and send it to others. They can join via the "Join Shared List" button.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Editor Code (Can modify tasks)</label>
                <div className="flex items-center">
                  <input 
                    type="text" 
                    readOnly 
                    value={generateShareCode('edit')} 
                    className="flex-1 bg-gray-50 border border-gray-300 rounded-l-md px-3 py-2 text-sm font-mono text-gray-600 focus:outline-none"
                  />
                  <button 
                    onClick={() => copyToClipboard(generateShareCode('edit'))}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-r-md border border-blue-600 transition-colors flex items-center gap-2"
                  >
                    <Copy size={16} /> <span className="hidden sm:inline">Copy</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Viewer Code (Read only)</label>
                <div className="flex items-center">
                  <input 
                    type="text" 
                    readOnly 
                    value={generateShareCode('view')} 
                    className="flex-1 bg-gray-50 border border-gray-300 rounded-l-md px-3 py-2 text-sm font-mono text-gray-600 focus:outline-none"
                  />
                  <button 
                    onClick={() => copyToClipboard(generateShareCode('view'))}
                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-r-md border border-gray-600 transition-colors flex items-center gap-2"
                  >
                    <Copy size={16} /> <span className="hidden sm:inline">Copy</span>
                  </button>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
                Editors: {currentList.editors?.length || 0} | Viewers: {currentList.viewers?.length || 0}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Join Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <UserPlus size={18} className="text-blue-500"/> Join a List
              </h2>
              <button onClick={() => { setShowJoinModal(false); setJoinCode(''); }} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleJoinList} className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                Paste the invite code shared with you to access a task list.
              </p>
              
              <input 
                type="text" 
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="e.g. bGlzdC0xMjM..."
                className="w-full bg-white border border-gray-300 rounded-md px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6"
                autoFocus
              />

              <div className="flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => { setShowJoinModal(false); setJoinCode(''); }}
                  className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={!joinCode.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors"
                >
                  Join List
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}