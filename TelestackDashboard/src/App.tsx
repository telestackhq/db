import { useState, useEffect } from 'react'
import {
    Plus,
    Database,
    FileText,
    Trash2,
    Search,
    RefreshCw,
    ChevronRight,
    User,
    LayoutDashboard,
    Settings,
    MoreVertical,
    X,
    Check
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

// Utility for merging classes
const cn = (...classes: any[]) => classes.filter(Boolean).join(' ')

export default function App() {
    const [navStack, setNavStack] = useState<{ type: 'collection' | 'doc', id: string }[]>([])
    const [collections, setCollections] = useState<string[]>([])
    const [documents, setDocuments] = useState<any[]>([])
    const [selectedDoc, setSelectedDoc] = useState<any | null>(null)
    const [subCollections, setSubCollections] = useState<string[]>([])

    const [loading, setLoading] = useState(false)
    const [isAddingCollection, setIsAddingCollection] = useState(false)
    const [isAddingDoc, setIsAddingDoc] = useState(false)
    const [newCollectionName, setNewCollectionName] = useState('')
    const [editData, setEditData] = useState('')
    const [newData, setNewData] = useState('{\n  "name": "New Document",\n  "status": "active"\n}')
    const [jsonError, setJsonError] = useState<string | null>(null)
    const [workspaceId, setWorkspaceId] = useState('default')
    const [viewMode, setViewMode] = useState<'fields' | 'history'>('fields')
    const [history, setHistory] = useState<any[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [queryWhere, setQueryWhere] = useState('')
    const [isQuerying, setIsQuerying] = useState(false)

    const API_ENDPOINT = 'https://telestack-realtime-db.codeforgebyaravinth.workers.dev'

    const currentCollection = navStack.filter(s => s.type === 'collection').pop()?.id
    const currentDoc = navStack.filter(s => s.type === 'doc').pop()?.id

    const fetchCollections = async (parentPath?: string) => {
        try {
            let url = parentPath
                ? `${API_ENDPOINT}/collections?parent=${parentPath}&workspaceId=${workspaceId}`
                : `${API_ENDPOINT}/collections?workspaceId=${workspaceId}`
            const res = await fetch(url)
            const data = await res.json()
            if (parentPath) setSubCollections(data)
            else setCollections(data.length > 0 ? data : [])
        } catch (e) {
            console.error(e)
        }
    }

    const fetchDocuments = async (collection: string, parentPath?: string) => {
        setLoading(true)
        try {
            let url = `${API_ENDPOINT}/documents/${collection}?workspaceId=${workspaceId}`
            if (parentPath) url += `&parentPath=${parentPath}`
            const res = await fetch(url)
            if (!res.ok) throw new Error(await res.text())
            const data = await res.json()
            setDocuments(data)
        } catch (e: any) {
            console.error(e)
            alert(`Fetch Error: ${e.message}`)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchCollections()
    }, [])

    useEffect(() => {
        if (navStack.length > 0) {
            const last = navStack[navStack.length - 1]
            if (last.type === 'collection') {
                const parentPath = navStack.slice(0, -1).map(s => s.id).join('/')
                fetchDocuments(last.id, parentPath)
                setSelectedDoc(null)
            } else {
                const docPath = navStack.map(s => s.id).join('/')
                fetchCollections(docPath)
            }
        } else {
            setDocuments([])
            setSelectedDoc(null)
        }
    }, [navStack])

    const pushNav = (type: 'collection' | 'doc', id: string) => {
        setNavStack([...navStack, { type, id }])
    }

    const popNav = (index: number) => {
        setNavStack(navStack.slice(0, index + 1))
    }

    const handleCreateDoc = async () => {
        if (!currentCollection) return
        let parsedData
        try {
            parsedData = JSON.parse(newData)
            setJsonError(null)
        } catch (e) {
            setJsonError("Invalid JSON structure")
            return
        }

        try {
            const parentPath = navStack.slice(0, -1).map(s => s.id).join('/')
            const res = await fetch(`${API_ENDPOINT}/documents/${currentCollection}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: parsedData,
                    userId: 'admin',
                    workspaceId: workspaceId,
                    parentPath: parentPath || undefined
                })
            })
            if (res.ok) {
                fetchDocuments(currentCollection, parentPath)
                setIsAddingDoc(false)
                setNewData('{\n  "name": "New Document",\n  "status": "active"\n}')
            } else {
                const err = await res.text()
                alert(`API Error: ${err}`)
            }
        } catch (e: any) {
            alert(`Network Error: ${e.message}`)
        }
    }

    const getType = (val: any) => {
        if (typeof val === 'string') return 'string'
        if (typeof val === 'number') return 'number'
        if (typeof val === 'boolean') return 'boolean'
        if (Array.isArray(val)) return 'array'
        if (val === null) return 'null'
        return 'object'
    }

    const handleUpdateDoc = async () => {
        if (!selectedDoc || !currentCollection) return
        let parsedData
        try {
            parsedData = JSON.parse(editData)
            setJsonError(null)
        } catch (e) {
            setJsonError("Invalid JSON structure")
            return
        }

        try {
            const res = await fetch(`${API_ENDPOINT}/documents/${currentCollection}/${selectedDoc.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: parsedData,
                    userId: 'admin',
                    workspaceId: workspaceId
                })
            })
            if (res.ok) {
                const parentPath = navStack.slice(0, -1).map(s => s.id).join('/')
                fetchDocuments(currentCollection, parentPath)
                alert("Saved successfully!")
            } else {
                const err = await res.text()
                alert(`Update failed: ${err}`)
            }
        } catch (e: any) {
            alert(`Network error: ${e.message}`)
        }
    }

    const fetchHistory = async (docId: string) => {
        setLoadingHistory(true)
        try {
            const res = await fetch(`${API_ENDPOINT}/documents/sync?workspaceId=${workspaceId}&docId=${docId}`)
            const data = await res.json()
            setHistory(data.changes || [])
        } catch (e) {
            console.error("Failed to fetch history", e)
        } finally {
            setLoadingHistory(false)
        }
    }

    useEffect(() => {
        if (selectedDoc && viewMode === 'history') {
            fetchHistory(selectedDoc.id)
        }
    }, [selectedDoc, viewMode])

    const executeQuery = async () => {
        if (!queryWhere) return
        setLoading(true)
        setIsQuerying(true)
        try {
            const res = await fetch(`${API_ENDPOINT}/documents/query?workspaceId=${workspaceId}&where=${encodeURIComponent(queryWhere)}`)
            const data = await res.json()
            if (data.error) alert(`Query Error: ${data.error}`)
            else setDocuments(data)
        } catch (e) {
            console.error("Query failed", e)
        } finally {
            setLoading(false)
        }
    }

    const handleDeleteDoc = async (id: string) => {
        if (!currentCollection) return
        if (!confirm("Are you sure?")) return
        await fetch(`${API_ENDPOINT}/documents/${currentCollection}/${id}`, {
            method: 'DELETE'
        })
        const parentPath = navStack.slice(0, -1).map(s => s.id).join('/')
        fetchDocuments(currentCollection, parentPath)
        if (selectedDoc?.id === id) setSelectedDoc(null)
    }

    const handleCreateCollection = () => {
        if (newCollectionName) {
            // In a path-based system, a collection "exists" when it has docs.
            // Pushing to nav stack is enough to "start" exploring it.
            pushNav('collection', newCollectionName)
            setIsAddingCollection(false)
            setNewCollectionName('')
        }
    }

    return (
        <div className="flex h-screen bg-[#f1f3f4] text-[#202124] overflow-hidden font-['Roboto', 'Segoe UI', 'arial', 'sans-serif']">
            {/* Sidebar - Firebase Style */}
            <aside className="w-[68px] flex flex-col items-center py-4 bg-white border-r border-[#e0e0e0] shrink-0 z-30 shadow-[1px_0_2px_rgba(0,0,0,0.05)]">
                <div className="w-10 h-10 mb-8 cursor-pointer flex items-center justify-center">
                    <div className="w-8 h-8 bg-[#ffca28] rounded-lg rotate-12 flex items-center justify-center shadow-sm">
                        <div className="w-6 h-6 bg-[#ffa000] rounded-md -rotate-12 flex items-center justify-center">
                            <Database className="w-4 h-4 text-white" />
                        </div>
                    </div>
                </div>

                <nav className="flex-1 flex flex-col items-center gap-6 w-full">
                    <div className="p-2 cursor-pointer text-[#5f6368] hover:text-[#1a73e8] transition-colors"><LayoutDashboard className="w-5 h-5" /></div>
                    <div className="p-2 cursor-pointer text-[#1a73e8] bg-[#e8f0fe] rounded-xl"><Database className="w-5 h-5" /></div>
                    <div className="p-2 cursor-pointer text-[#5f6368] hover:text-[#1a73e8] transition-colors"><User className="w-5 h-5" /></div>
                    <div className="p-2 cursor-pointer text-[#5f6368] hover:text-[#1a73e8] transition-colors"><Settings className="w-5 h-5" /></div>

                    <div className="mt-auto p-2 cursor-pointer text-[#5f6368] hover:text-[#1a73e8] transition-colors border-t border-[#f1f3f4] pt-4 w-full flex justify-center">
                        <ChevronRight className="w-5 h-5" />
                    </div>
                </nav>
            </aside>

            {/* Main Application Area */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                {/* Global Header */}
                <header className="h-14 bg-white border-b border-[#e0e0e0] flex items-center px-4 justify-between shrink-0 z-20">
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-[#f1f3f4] rounded-md cursor-pointer transition-colors group">
                            <span className="text-sm font-medium text-[#3c4043]">Chat C444</span>
                            <MoreVertical className="w-3.5 h-3.5 text-[#5f6368] rotate-90" />
                        </div>
                        <div className="h-4 w-[1px] bg-[#e0e0e0] mx-2" />
                        <div className="flex items-center gap-2 text-sm">
                            <span className="text-[#5f6368]">Cloud Firestore</span>
                            <ChevronRight className="w-4 h-4 text-[#dadce0]" />
                            <span className="text-[#202124] font-medium">Database</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <button className="text-[#1a73e8] text-xs font-semibold hover:bg-[#f1f3f4] px-3 py-2 rounded transition-colors">Configure App Check</button>
                        <Settings className="w-5 h-5 text-[#5f6368] cursor-pointer" />
                        <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm">A</div>
                    </div>
                </header>

                {/* Sub-header with Breadcrumbs Card */}
                <div className="px-6 py-4 flex flex-col gap-4">
                    <div className="bg-white rounded-lg shadow-sm border border-[#e0e0e0] flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-4 text-sm">
                            <div className="p-1 hover:bg-[#f1f3f4] rounded transition-colors cursor-pointer" onClick={() => setNavStack([])}>
                                <div className="w-5 h-5 border-2 border-[#5f6368] rounded-sm flex items-center justify-center">
                                    <div className="w-3 h-3 bg-[#5f6368] rounded-[1px]" />
                                </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-[#dadce0]" />
                            <div className="flex items-center gap-1">
                                {navStack.length === 0 ? (
                                    <span className="text-[#5f6368] font-medium">(default)</span>
                                ) : (
                                    navStack.map((item, i) => (
                                        <div key={i} className="flex items-center gap-1">
                                            <button
                                                onClick={() => popNav(i)}
                                                className={cn(
                                                    "hover:underline transition-all underline-offset-4",
                                                    i === navStack.length - 1 ? "text-[#202124] font-semibold" : "text-[#5f6368]"
                                                )}
                                            >
                                                {item.id}
                                            </button>
                                            {i < navStack.length - 1 && <ChevronRight className="w-4 h-4 text-[#dadce0]" />}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <button className="flex items-center gap-2 text-[#1a73e8] text-sm font-medium hover:bg-[#e8f0fe] px-3 py-1.5 rounded transition-all">
                                <Search className="w-4 h-4" />
                                <span>Query builder</span>
                            </button>
                            <MoreVertical className="w-4 h-4 text-[#5f6368] cursor-pointer" />
                        </div>
                    </div>
                </div>

                {/* Main Content - Multi-column drill-down */}
                <div className="flex-1 flex px-6 pb-6 overflow-hidden">
                    <div className="flex-1 bg-white rounded-lg shadow-sm border border-[#e0e0e0] flex overflow-hidden">

                        {/* Column 1: Collections */}
                        <div className="w-1/4 min-w-[300px] border-r border-[#e0e0e0] flex flex-col">
                            <div className="h-14 flex items-center justify-between px-4 border-b border-[#e0e0e0]">
                                <div className="flex items-center gap-2 text-[#5f6368]">
                                    <Database className="w-4 h-4" />
                                    <span className="text-sm font-medium">(default)</span>
                                </div>
                                <MoreVertical className="w-4 h-4 text-[#dadce0]" />
                            </div>
                            <div className="p-2">
                                <button
                                    onClick={() => setIsAddingCollection(true)}
                                    className="w-full flex items-center gap-4 px-3 py-2 text-[#1a73e8] hover:bg-[#f1f3f4] rounded-md transition-all text-sm font-medium group"
                                >
                                    <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
                                    <span>Start collection</span>
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5 custom-scrollbar">
                                {(navStack.length === 0 || navStack[navStack.length - 1].type === 'doc') ? (
                                    (navStack.length === 0 ? collections : subCollections).map(col => (
                                        <button
                                            key={col}
                                            onClick={() => pushNav('collection', col)}
                                            className={cn(
                                                "w-full text-left px-3 py-3 rounded-md text-sm transition-all flex items-center justify-between group relative",
                                                currentCollection === col ? "bg-[#e8f0fe] text-[#1a73e8] before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1.5 before:bg-[#1a73e8] before:rounded-r-full" : "text-[#5f6368] hover:bg-[#f8f9fa] hover:text-[#202124]"
                                            )}
                                        >
                                            <span className="font-medium truncate">{col}</span>
                                            <ChevronRight className={cn("w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity", currentCollection === col ? "opacity-100" : "")} />
                                        </button>
                                    ))
                                ) : (
                                    <div className="p-6 text-center text-[#9aa0a6] flex flex-col items-center">
                                        <Database className="w-8 h-8 mb-4 opacity-10" />
                                        <p className="text-xs italic leading-relaxed font-medium">Select a document to drill into its sub-collections</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Column 2: Documents */}
                        <div className="w-1/4 min-w-[300px] border-r border-[#e0e0e0] flex flex-col bg-[#fafafa]">
                            <div className="flex flex-col border-b border-[#e0e0e0] bg-white">
                                <div className="h-14 flex items-center justify-between px-4">
                                    <div className="flex items-center gap-2 text-[#5f6368]">
                                        <div className="w-4 h-4 border border-[#5f6368] rounded-sm flex items-center justify-center">
                                            <div className="w-2.5 h-2.5 bg-[#5f6368] rounded-[1px]" />
                                        </div>
                                        <span className="text-sm font-medium truncate max-w-[150px]">{currentCollection || 'Choose collection'}</span>
                                        <button
                                            onClick={() => setIsQuerying(!isQuerying)}
                                            className={cn("p-1.5 rounded transition-colors", isQuerying ? "bg-[#e8f0fe] text-[#1a73e8]" : "text-[#dadce0] hover:text-[#5f6368]")}
                                        >
                                            <Search className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    <MoreVertical className="w-4 h-4 text-[#dadce0]" />
                                </div>
                                {isQuerying && (
                                    <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-200">
                                        <div className="bg-[#f8f9fa] border border-[#e0e0e0] rounded-lg p-3 shadow-inner">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-[10px] font-bold text-[#5f6368] uppercase tracking-widest font-mono">WHERE Clause</span>
                                                <button onClick={() => { setIsQuerying(false); setDocuments([]); fetchDocuments(currentCollection!); }} className="text-[10px] text-[#1a73e8] font-bold hover:underline">Clear</button>
                                            </div>
                                            <textarea
                                                value={queryWhere}
                                                onChange={(e) => setQueryWhere(e.target.value)}
                                                placeholder="e.g. json_extract(data, '$.status') = 'active'"
                                                className="w-full h-20 bg-white border border-[#dadce0] rounded p-2 text-xs font-mono outline-none focus:border-[#1a73e8] resize-none"
                                            />
                                            <button
                                                onClick={executeQuery}
                                                className="w-full mt-2 py-1.5 bg-[#1a73e8] text-white text-[10px] font-bold uppercase tracking-wider rounded shadow-sm hover:bg-[#1557b0] transition-all"
                                            >
                                                Run Query
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="p-2">
                                <button
                                    onClick={() => { setNewData('{\n  "name": "New Document"\n}'); setIsAddingDoc(true); }}
                                    disabled={!currentCollection}
                                    className="w-full flex items-center gap-4 px-3 py-2 text-[#1a73e8] hover:bg-[#f1f3f4] rounded-md transition-all text-sm font-medium disabled:opacity-30 group"
                                >
                                    <Plus className="w-4 h-4 transition-transform group-hover:rotate-90" />
                                    <span>Add document</span>
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5 custom-scrollbar">
                                {loading ? (
                                    <div className="flex flex-col items-center justify-center h-40 gap-3 opacity-30">
                                        <RefreshCw className="w-6 h-6 text-[#1a73e8] animate-spin" />
                                        <span className="text-[10px] font-bold uppercase tracking-widest">Syncing Cloud...</span>
                                    </div>
                                ) : documents.length > 0 ? (
                                    documents.map(doc => (
                                        <button
                                            key={doc.id}
                                            onClick={() => {
                                                setSelectedDoc(doc)
                                                setEditData(JSON.stringify(doc.data, null, 2))
                                            }}
                                            className={cn(
                                                "w-full text-left px-3 py-3 rounded-md text-sm transition-all flex items-center justify-between group relative",
                                                selectedDoc?.id === doc.id ? "bg-[#e8f0fe] text-[#1a73e8] before:content-[''] before:absolute before:left-0 before:top-1 before:bottom-1 before:w-1.5 before:bg-[#1a73e8] before:rounded-r-full" : "text-[#5f6368] hover:bg-[#f8f9fa] hover:text-[#202124]"
                                            )}
                                        >
                                            <span className="font-medium truncate flex-1">{doc.id}</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id); }}
                                                className="p-1 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                            <ChevronRight className={cn("w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity", selectedDoc?.id === doc.id ? "opacity-100" : "")} />
                                        </button>
                                    ))
                                ) : (
                                    <div className="p-12 text-center text-[#dadce0] flex flex-col items-center">
                                        <FileText className="w-12 h-12 mb-4 opacity-10" />
                                        <p className="text-xs font-medium italic">Empty collection</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Column 3: Fields & Data View */}
                        <div className="flex-1 flex flex-col min-w-[400px]">
                            <div className="h-14 flex items-center justify-between px-6 border-b border-[#e0e0e0] bg-white shrink-0">
                                <div className="flex items-center gap-3 text-[#5f6368]">
                                    <FileText className="w-4 h-4" />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium truncate max-w-[200px]">{selectedDoc?.id || 'Choose document'}</span>
                                        {selectedDoc && <span className="text-[9px] font-bold text-[#1a73e8] uppercase tracking-tighter">Version {selectedDoc.version || 1}</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 bg-[#f1f3f4] p-1 rounded-md">
                                    <button
                                        onClick={() => setViewMode('fields')}
                                        className={cn("px-3 py-1 text-[10px] font-bold uppercase rounded transition-all", viewMode === 'fields' ? "bg-white text-[#1a73e8] shadow-sm" : "text-[#5f6368] hover:text-[#202124]")}
                                    >
                                        Fields
                                    </button>
                                    <button
                                        onClick={() => setViewMode('history')}
                                        className={cn("px-3 py-1 text-[10px] font-bold uppercase rounded transition-all", viewMode === 'history' ? "bg-white text-[#1a73e8] shadow-sm" : "text-[#5f6368] hover:text-[#202124]")}
                                    >
                                        History
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6 custom-scrollbar">
                                {selectedDoc ? (
                                    viewMode === 'fields' ? (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <button className="flex items-center gap-2 text-[#1a73e8] text-sm font-medium hover:bg-[#e8f0fe] px-3 py-1.5 rounded transition-all">
                                                    <Plus className="w-4 h-4" />
                                                    <span>Add field</span>
                                                </button>
                                                <div className="flex gap-2">
                                                    <button onClick={() => pushNav('doc', selectedDoc.id)} className="px-4 py-1.5 border border-[#dadce0] text-[#5f6368] text-sm font-medium rounded hover:bg-[#f8f9fa] transition-all">Sub-collections</button>
                                                    <button onClick={handleUpdateDoc} className="px-6 py-1.5 bg-[#1a73e8] text-white text-sm font-medium rounded hover:bg-[#1557b0] transition-all shadow-sm">Save</button>
                                                </div>
                                            </div>

                                            <div className="border border-[#e0e0e0] rounded-lg overflow-hidden flex flex-col bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                                                <div className="flex-1 p-2 space-y-0.5 min-h-[300px]">
                                                    {Object.entries(selectedDoc.data).map(([key, val]) => (
                                                        <div key={key} className="flex items-center py-3 px-4 border-b border-[#f1f3f4] last:border-0 hover:bg-[#fafafa] transition-colors group">
                                                            <div className="w-40 text-sm font-medium text-[#202124] shrink-0 truncate">{key}</div>
                                                            <div className="flex items-center gap-4 flex-1 min-w-0">
                                                                <div className="px-2 py-0.5 rounded bg-[#f1f3f4] text-[10px] font-bold text-[#5f6368] uppercase tracking-tighter shrink-0">{getType(val)}</div>
                                                                <div className="flex-1 text-sm text-[#5f6368] truncate font-normal leading-relaxed">{JSON.stringify(val)}</div>
                                                            </div>
                                                            <div className="opacity-0 group-hover:opacity-100 flex gap-2 ml-4">
                                                                <button className="text-[#1a73e8] hover:underline text-xs font-medium">Edit</button>
                                                                <button className="text-red-500 hover:text-red-600">
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Advanced JSON Editor */}
                                                <div className="bg-[#f8f9fa] border-t border-[#e0e0e0] p-4">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <label className="text-[10px] font-bold text-[#5f6368] uppercase tracking-widest font-mono">JSON View / Bulk Edit</label>
                                                        {jsonError && <span className="text-[10px] text-red-500 font-bold">{jsonError}</span>}
                                                    </div>
                                                    <textarea
                                                        value={editData}
                                                        onChange={(e) => {
                                                            setEditData(e.target.value)
                                                            try { JSON.parse(e.target.value); setJsonError(null); }
                                                            catch (err) { setJsonError("Invalid JSON"); }
                                                        }}
                                                        className={cn(
                                                            "w-full h-40 p-3 bg-white border border-[#dadce0] rounded-md font-mono text-xs text-[#202124] outline-none transition-all resize-none shadow-inner",
                                                            jsonError ? "border-red-300 ring-2 ring-red-50 ring-offset-0" : "focus:border-[#1a73e8] focus:ring-2 ring-blue-50"
                                                        )}
                                                        spellCheck={false}
                                                    />
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="flex flex-col gap-4">
                                            <div className="flex items-center justify-between">
                                                <h4 className="text-xs font-bold text-[#5f6368] uppercase tracking-widest">History / Time Travel</h4>
                                                <button onClick={() => fetchHistory(selectedDoc.id)} className="p-1.5 hover:bg-[#f1f3f4] rounded transition-colors">
                                                    <RefreshCw className={cn("w-4 h-4 text-[#1a73e8]", loadingHistory ? "animate-spin" : "")} />
                                                </button>
                                            </div>
                                            <div className="space-y-3">
                                                {history.length > 0 ? history.map((event: any) => (
                                                    <div key={event.id} className="relative pl-8 before:content-[''] before:absolute before:left-3 before:top-2 before:bottom-0 before:w-[1px] before:bg-[#e0e0e0] last:before:bg-transparent">
                                                        <div className={cn(
                                                            "absolute left-1.5 top-2 w-3 h-3 rounded-full border-2 bg-white",
                                                            event.event_type === 'INSERT' ? "border-green-500" : event.event_type === 'UPDATE' ? "border-blue-500" : "border-red-500"
                                                        )} />
                                                        <div className="bg-white border border-[#e0e0e0] rounded-lg p-4 shadow-sm group hover:border-[#1a73e8] transition-all">
                                                            <div className="flex items-center justify-between mb-2">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] font-bold text-[#202124] uppercase">{event.event_type}</span>
                                                                    <span className="text-[9px] font-medium text-[#5f6368]">{new Date(event.created_at).toLocaleString()}</span>
                                                                </div>
                                                                <span className="text-[9px] font-mono text-[#1a73e8] font-bold">v{event.version}</span>
                                                            </div>
                                                            <pre className="text-[10px] text-[#5f6368] bg-[#f8f9fa] p-2 rounded overflow-x-auto font-mono leading-relaxed max-h-40">
                                                                {JSON.stringify(JSON.parse(event.payload), null, 2)}
                                                            </pre>
                                                            <button className="mt-3 text-[10px] font-bold text-[#1a73e8] hover:underline opacity-0 group-hover:opacity-100 transition-opacity">Restore this state</button>
                                                        </div>
                                                    </div>
                                                )) : (
                                                    <div className="p-12 text-center text-[#dadce0] flex flex-col items-center">
                                                        <RefreshCw className="w-12 h-12 mb-4 opacity-10" />
                                                        <p className="text-xs font-medium italic">No events recorded yet</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                ) : (
                                    <div className="flex-1 flex flex-col items-center justify-center p-20 text-center text-[#dadce0]">
                                        <div className="w-24 h-24 rounded-full bg-[#f1f3f4] flex items-center justify-center mb-6">
                                            <Database className="w-10 h-10 opacity-20" />
                                        </div>
                                        <h3 className="text-lg font-medium text-[#5f6368] mb-2">No document selected</h3>
                                        <p className="text-sm italic max-w-xs leading-relaxed">Select a document from the previous column to view and edit its fields.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Metadata */}
                <footer className="h-10 bg-[#f1f3f4] border-t border-[#e0e0e0] flex items-center px-6 justify-between shrink-0">
                    <div className="flex items-center gap-4 text-[11px] text-[#5f6368] font-medium">
                        <div className="flex items-center gap-1.5 hover:text-[#1a73e8] cursor-pointer transition-colors">
                            <Settings className="w-3.5 h-3.5" />
                            <span>Database location: nam5</span>
                        </div>
                        <div className="w-[1px] h-3 bg-[#dadce0]" />
                        <div className="hover:text-[#1a73e8] cursor-pointer transition-colors">Documentation</div>
                    </div>
                    <div className="text-[10px] text-[#9aa0a6] flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <span>Workspaces / {workspaceId}</span>
                    </div>
                </footer>
            </main>

            {/* Firebase Themed Modals */}
            <AnimatePresence>
                {isAddingCollection && (
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center z-[100]">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="bg-white rounded-xl w-[500px] shadow-2xl overflow-hidden"
                        >
                            <div className="p-6 border-b border-[#e0e0e0]">
                                <h3 className="text-xl font-medium text-[#202124]">{navStack[navStack.length - 1]?.type === 'doc' ? 'New sub-collection' : 'Start a collection'}</h3>
                                <p className="text-sm text-[#5f6368] mt-1 italic">Enter a name for your new collection path.</p>
                            </div>
                            <div className="p-8">
                                <label className="block text-xs font-bold text-[#5f6368] uppercase mb-2 tracking-widest">Collection ID</label>
                                <input
                                    autoFocus
                                    type="text"
                                    placeholder="e.g. users, posts"
                                    value={newCollectionName}
                                    onChange={(e) => setNewCollectionName(e.target.value)}
                                    className="w-full border-b-2 border-[#1a73e8] p-3 text-lg text-[#202124] focus:outline-none bg-[#f8f9fa] rounded-t-md font-medium transition-all"
                                />
                            </div>
                            <div className="p-6 bg-[#f8f9fa] flex justify-end gap-3">
                                <button onClick={() => setIsAddingCollection(false)} className="px-6 py-2 text-[#5f6368] font-medium hover:bg-[#e0e0e0] rounded transition-all">Cancel</button>
                                <button onClick={handleCreateCollection} className="px-8 py-2 bg-[#1a73e8] text-white font-medium rounded shadow-sm hover:bg-[#1557b0] transition-all">Next</button>
                            </div>
                        </motion.div>
                    </div>
                )}

                {isAddingDoc && (
                    <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center z-[100]">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 10 }}
                            className="bg-white rounded-xl w-[700px] shadow-2xl overflow-hidden"
                        >
                            <div className="p-6 border-b border-[#e0e0e0]">
                                <h3 className="text-xl font-medium text-[#202124]">Add document to {currentCollection}</h3>
                            </div>
                            <div className="p-8 space-y-6">
                                <div className="p-4 bg-[#e8f0fe] rounded-lg border border-[#1a73e8]/20 flex items-start gap-4">
                                    <Database className="w-5 h-5 text-[#1a73e8] mt-1 shrink-0" />
                                    <div>
                                        <p className="text-sm text-[#1a73e8] font-semibold">Automatic ID Generation</p>
                                        <p className="text-xs text-[#5f6368] leading-relaxed">Leave the ID field blank to have Telestack automatically generate a unique, secure identifier for this document.</p>
                                    </div>
                                </div>
                                <div className="h-64 border rounded-md overflow-hidden relative border-[#e0e0e0]">
                                    <textarea
                                        value={newData}
                                        onChange={(e) => {
                                            setNewData(e.target.value)
                                            try { JSON.parse(e.target.value); setJsonError(null); }
                                            catch (err) { setJsonError("Invalid JSON structure"); }
                                        }}
                                        className={cn(
                                            "w-full h-full p-4 font-mono text-sm outline-none bg-white",
                                            jsonError ? "text-red-500" : "text-[#202124]"
                                        )}
                                        spellCheck={false}
                                    />
                                    {jsonError && (
                                        <div className="absolute bottom-4 right-4 text-[10px] text-red-500 font-bold uppercase tracking-widest">{jsonError}</div>
                                    )}
                                </div>
                            </div>
                            <div className="p-6 bg-[#f8f9fa] flex justify-end gap-3">
                                <button onClick={() => setIsAddingDoc(false)} className="px-6 py-2 text-[#5f6368] font-medium hover:bg-[#e0e0e0] rounded transition-all">Cancel</button>
                                <button onClick={handleCreateDoc} className="px-8 py-2 bg-[#1a73e8] text-white font-medium rounded shadow-sm hover:bg-[#1557b0] transition-all">Save</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    )
}
