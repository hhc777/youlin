"use client";
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

// --- 类型定义 ---
interface Item {
  id: string;
  title: string;
  description: string;
  type: 'offer' | 'seek';
  city: string;
  area?: string | null;
  status: string;
  user_id: string;
  created_at: string;
}

type ModalType = 'publish' | 'detail' | 'profile' | 'auth' | 'city' | 'inbox' | 'chat' | 'edit' | null;

interface PostForm {
  title: string;
  desc: string;
  type: 'offer' | 'seek';
  area?: string;
}

interface AuthForm {
  email: string;
  password: string;
  isLogin: boolean;
}

interface ToastMessage {
  message: string;
  type: 'success' | 'error' | 'info';
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  item_id?: string;
}

interface Conversation {
  id: string;
  item_id: string;
  participant1_id: string;
  participant2_id: string;
  created_at: string;
  last_message_at?: string;
}

const POPULAR_CITIES = ['北京市', '上海市', '广州市', '深圳市', '杭州市', '成都市'] as const;

// --- Supabase 客户端单例 ---
const getSupabaseClient = (): SupabaseClient => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }
  
  return createClient(url, key);
};

export default function YouLinFullStack() {
  // --- Supabase 客户端 ---
  const supabase = useMemo(() => getSupabaseClient(), []);
  
  // --- 基础状态 ---
  const [user, setUser] = useState<User | null>(null);
  const [energy, setEnergy] = useState<number>(10); // 默认初始能量
  const [items, setItems] = useState<Item[]>([]);
  const [currentCity, setCurrentCity] = useState<string>('上海市');
  const [currentArea, setCurrentArea] = useState<string>(''); 
  
  // --- Modal & UI 状态 ---
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  
  // --- 表单状态 ---
  const [postForm, setPostForm] = useState<PostForm>({ title: '', desc: '', type: 'offer', area: '' });
  const [authForm, setAuthForm] = useState<AuthForm>({ email: '', password: '', isLogin: true });
  const [editForm, setEditForm] = useState<PostForm>({ title: '', desc: '', type: 'offer' });
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  
  // --- 聊天/用户数据状态 ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [userItems, setUserItems] = useState<Item[]>([]);
  const [isLoadingUserItems, setIsLoadingUserItems] = useState(false);

  // --- Toast 工具 ---
  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // --- 1. 初始化用户与能量 ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (session?.user) {
          setUser(session.user);
          // 尝试获取用户的能量值 (假设存在 profiles 表)
          const { data: profile } = await supabase.from('profiles').select('energy').eq('id', session.user.id).single();
          if (profile) setEnergy(profile.energy);
        }
      } catch (error) {
        console.error('Session check failed', error);
      }
    };
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  // --- 2. 获取物品列表 ---
  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('items')
        .select('*')
        .eq('city', currentCity)
        .eq('status', 'active');

      if (currentArea) {
        query = query.ilike('area', `%${currentArea}%`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      setItems((data as Item[]) || []);
    } catch (error) {
      console.error('Fetch error:', error);
      showToast('获取数据失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [currentCity, currentArea, supabase, showToast]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // --- 3. 发布逻辑 (集成能量流动：索取-3，赠予+5) ---
  const handlePublish = async () => {
    if (!user) {
      setActiveModal('auth');
      showToast('请先登录', 'info');
      return;
    }
    if (!postForm.title.trim()) {
      showToast('标题不能为空', 'error');
      return;
    }

    // 能量流动规则检查
    const energyChange = postForm.type === 'offer' ? 5 : -3;
    if (postForm.type === 'seek' && energy < 3) {
      showToast('能量不足，无法发起索取 (需要3能量)', 'error');
      return;
    }
    
    setIsSubmitting(true);
    try {
      // A. 插入物品数据
      const { error: itemError } = await supabase.from('items').insert([{
        title: postForm.title.trim(),
        description: postForm.desc.trim(),
        type: postForm.type,
        user_id: user.id,
        city: currentCity,
        area: postForm.area?.trim() || null,
        status: 'active',
      }]);

      if (itemError) throw itemError;

      // B. 能量结算 (更新 profile)
      const newEnergy = energy + energyChange;
      const { error: energyError } = await supabase
        .from('profiles')
        .update({ energy: newEnergy })
        .eq('id', user.id);
      
      // 注意：这里为了前端即时反馈进行本地更新
      setEnergy(newEnergy);

      setPostForm({ title: '', desc: '', type: 'offer', area: '' });
      setActiveModal(null);
      await fetchItems();
      showToast(postForm.type === 'offer' ? '发布成功，能量 +5' : '发布成功，能量 -3', 'success');
    } catch (error: any) {
      showToast(error.message || '操作失败', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- 4. 认证逻辑 ---
  const handleAuth = async () => {
    if (!authForm.email.trim() || !authForm.password.trim()) {
      showToast('请填写完整信息', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = authForm.isLogin 
        ? await supabase.auth.signInWithPassword({
            email: authForm.email.trim(),
            password: authForm.password
          })
        : await supabase.auth.signUp({
            email: authForm.email.trim(),
            password: authForm.password
          });
      
      if (error) throw error;

      setUser(data.user);
      setActiveModal(null);
      setAuthForm({ email: '', password: '', isLogin: true });
      showToast(authForm.isLogin ? '登录成功' : '注册成功，请查收邮件', 'success');
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setEnergy(10);
    setActiveModal(null);
    showToast('已退出登录', 'info');
  };

  // --- 5. 用户发布管理 (Profile) ---
  const fetchUserItems = useCallback(async () => {
    if (!user) return;
    setIsLoadingUserItems(true);
    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUserItems((data as Item[]) || []);
    } catch (error) {
      showToast('获取个人列表失败', 'error');
    } finally {
      setIsLoadingUserItems(false);
    }
  }, [user, supabase, showToast]);

  useEffect(() => {
    if (activeModal === 'profile' && user) fetchUserItems();
  }, [activeModal, user, fetchUserItems]);

  const handleEditItem = (item: Item) => {
    setEditingItem(item);
    setEditForm({
      title: item.title,
      desc: item.description,
      type: item.type as 'offer' | 'seek',
      area: item.area || '',
    });
    setActiveModal('edit');
  };

  const handleUpdateItem = async () => {
    if (!editingItem || !user || !editForm.title.trim()) {
      showToast('信息不完整', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('items')
        .update({
          title: editForm.title.trim(),
          description: editForm.desc.trim(),
          type: editForm.type,
          area: editForm.area?.trim() || null,
        })
        .eq('id', editingItem.id)
        .eq('user_id', user.id);

      if (error) throw error;
      
      showToast('更新成功', 'success');
      setActiveModal('profile');
      setEditingItem(null);
      await fetchUserItems();
      await fetchItems();
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (item: Item) => {
    if (!user || !confirm(`确定要撤销"${item.title}"吗？`)) return;
    
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('items')
        .update({ status: 'inactive' })
        .eq('id', item.id)
        .eq('user_id', user.id);

      if (error) throw error;
      
      showToast('已撤销', 'success');
      await fetchUserItems();
      await fetchItems();
    } catch (error: any) {
      showToast('操作失败', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- 6. 聊天系统 ---
  const initConversation = useCallback(async (item: Item) => {
    if (!user) {
      setActiveModal('auth');
      showToast('请先登录', 'info');
      return;
    }
    if (user.id === item.user_id) {
      showToast('不能和自己聊天', 'error');
      return;
    }

    setIsLoadingMessages(true);
    try {
      const { data: existingConvs } = await supabase
        .from('conversations')
        .select('*')
        .eq('item_id', item.id);
      
      const existingConv = existingConvs?.find(
        c => (c.participant1_id === user.id && c.participant2_id === item.user_id) ||
             (c.participant1_id === item.user_id && c.participant2_id === user.id)
      );

      let convId = existingConv?.id;

      if (!convId) {
        const { data: newConv, error } = await supabase
          .from('conversations')
          .insert([{
            item_id: item.id,
            participant1_id: user.id,
            participant2_id: item.user_id,
          }])
          .select()
          .single();
        
        if (error) {
          if (error.code === 'PGRST116' || error.message.includes('not exist')) {
            showToast('演示模式：数据库表不存在，使用本地临时会话', 'info');
            setCurrentConversation({
              id: `temp_${item.id}`,
              item_id: item.id,
              participant1_id: user.id,
              participant2_id: item.user_id,
              created_at: new Date().toISOString()
            } as Conversation);
            setIsLoadingMessages(false);
            return;
          }
          throw error;
        }
        convId = newConv.id;
        setCurrentConversation(newConv);
      } else {
        setCurrentConversation(existingConv as Conversation);
      }

      if (convId) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true });
        setMessages((msgs as Message[]) || []);
      }
    } catch (error) {
      console.error(error);
      showToast('对话初始化失败', 'error');
    } finally {
      setIsLoadingMessages(false);
    }
  }, [user, supabase, showToast]);

  const handleSendMessage = async () => {
    if (!user || !currentConversation || !messageInput.trim()) return;
    
    setIsSubmitting(true);
    try {
      const receiverId = currentConversation.participant1_id === user.id 
        ? currentConversation.participant2_id 
        : currentConversation.participant1_id;

      if (currentConversation.id.startsWith('temp_')) {
        const tempMsg: Message = {
          id: `local_${Date.now()}`,
          conversation_id: currentConversation.id,
          sender_id: user.id,
          receiver_id: receiverId,
          content: messageInput.trim(),
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, tempMsg]);
        setMessageInput('');
        return;
      }

      const { data, error } = await supabase
        .from('messages')
        .insert([{
          conversation_id: currentConversation.id,
          sender_id: user.id,
          receiver_id: receiverId,
          content: messageInput.trim(),
          item_id: selectedItem?.id
        }])
        .select()
        .single();

      if (error) throw error;

      setMessages(prev => [...prev, data as Message]);
      setMessageInput('');
      
      await supabase.from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', currentConversation.id);

    } catch (error: any) {
      showToast('发送失败: ' + error.message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (activeModal === 'chat' && selectedItem) {
      initConversation(selectedItem);
    } else if (activeModal !== 'chat') {
      setMessages([]);
      setCurrentConversation(null);
    }
  }, [activeModal, selectedItem, initConversation]);


  // --- Render ---
  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#2D341E] font-sans">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[300] px-6 py-3 rounded-2xl shadow-xl text-xs font-black animate-in fade-in slide-in-from-top-2 ${
          toast.type === 'success' ? 'bg-[#5F743A] text-white' :
          toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-gray-800 text-white'
        }`}>
          {toast.message}
        </div>
      )}
      
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 h-20 bg-white/90 backdrop-blur-xl border-b border-gray-100 z-[100] px-8">
        <div className="max-w-5xl mx-auto h-full flex justify-between items-center">
          <div onClick={() => setActiveModal('city')} className="cursor-pointer group flex flex-col">
            <span className="text-[10px] font-black text-gray-300 block uppercase">Nearby Node</span>
            <span className="text-sm font-black text-[#5F743A]">📍 {currentCity}</span>
          </div>
          
          <h1 className="text-2xl font-black italic text-[#5F743A] tracking-tighter">有邻</h1>

          <div className="flex items-center gap-6">
            {/* 能量显示 */}
            {user && (
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-black text-gray-300 uppercase">Energy</span>
                <span className="text-sm font-black text-[#5F743A]">⚡ {energy}</span>
              </div>
            )}
            <button onClick={() => setActiveModal('inbox')} className="text-2xl hover:scale-110 transition-transform">✉️</button>
            <button onClick={() => setActiveModal('profile')} className="text-2xl hover:scale-110 transition-transform">👤</button>
            <button 
              onClick={() => user ? setActiveModal('publish') : setActiveModal('auth')}
              className="bg-[#5F743A] text-white px-6 py-2 rounded-full text-xs font-black shadow-lg active:scale-95 transition-all hover:bg-[#4d5e2e]"
            >
              播撒萤火
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-8 pt-32 pb-20">
        {/* Area Filter */}
        {currentCity && (
          <div className="mb-8 bg-white p-4 rounded-2xl border border-gray-50 shadow-sm flex items-center gap-3">
            <span className="text-[10px] font-black text-gray-400 uppercase">区域筛选</span>
            <input
              type="text"
              placeholder="输入区域（如：朝阳区）"
              value={currentArea}
              onChange={(e) => setCurrentArea(e.target.value)}
              className="flex-1 bg-gray-50 p-3 rounded-xl text-xs outline-none focus:ring-2 focus:ring-[#5F743A]/10 transition-all"
            />
            {currentArea && (
              <button onClick={() => setCurrentArea('')} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-black hover:bg-gray-200">清除</button>
            )}
          </div>
        )}

        {/* Item Grid */}
        {isLoading ? (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-4 border-[#5F743A] border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 text-xs text-gray-400 font-black">正在感应附近的萤火...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-gray-300 italic">这一带暂时没有萤火...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {items.map(item => (
              <div 
                key={item.id} 
                onClick={() => { setSelectedItem(item); setActiveModal('detail'); }} 
                className="bg-white p-8 rounded-[3rem] border border-gray-100 hover:shadow-xl transition-all cursor-pointer group hover:-translate-y-1 duration-300"
              >
                <div className="flex items-center gap-2 mb-4">
                  <span className={`text-[9px] font-black px-3 py-1 rounded-full ${item.type === 'offer' ? 'bg-[#F2F6E9] text-[#5F743A]' : 'bg-blue-50 text-blue-500'}`}>
                    {item.type === 'offer' ? '🌿 赠予' : '💎 索取'}
                  </span>
                  {item.area && <span className="text-[9px] text-gray-400 font-bold">📍 {item.area}</span>}
                </div>
                <h3 className="text-lg font-black text-gray-800 mb-2 group-hover:text-[#5F743A] transition-colors">{item.title}</h3>
                <p className="text-xs text-gray-400 italic line-clamp-2">"{item.description || '暂无描述'}"</p>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* --- Modal System --- */}
      {activeModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-md" onClick={() => setActiveModal(null)} />
          
          <div className={`relative bg-white w-full rounded-[3.5rem] shadow-2xl p-10 animate-in zoom-in-95 duration-200 ${
            activeModal === 'chat' ? 'max-w-md h-[600px] max-h-[80vh]' : 'max-w-sm'
          }`}>
            <button 
              onClick={() => setActiveModal(null)} 
              className="absolute top-10 right-10 text-gray-300 hover:text-gray-600 text-xl leading-none z-10"
            >✕</button>

            {/* 1. 发布 Modal */}
            {activeModal === 'publish' && (
              <div className="space-y-5">
                <h3 className="text-xl font-black text-[#5F743A] italic">播撒萤火</h3>
                <div className="p-3 bg-gray-50 rounded-xl text-center">
                  <p className="text-[10px] font-black text-gray-400 uppercase">当前能量：⚡ {energy}</p>
                </div>
                <input 
                  placeholder="标题" 
                  className="w-full bg-gray-50 p-4 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#5F743A]/10" 
                  value={postForm.title} 
                  onChange={e => setPostForm({...postForm, title: e.target.value})}
                />
                <div className="flex gap-2">
                  <button onClick={() => setPostForm({...postForm, type:'offer'})} className={`flex-1 py-3 rounded-xl text-xs font-black transition-all ${postForm.type==='offer' ? 'bg-[#5F743A] text-white' : 'bg-gray-100 text-gray-400'}`}>🌿 赠予 (+5)</button>
                  <button onClick={() => setPostForm({...postForm, type:'seek'})} className={`flex-1 py-3 rounded-xl text-xs font-black transition-all ${postForm.type==='seek' ? 'bg-[#5F743A] text-white' : 'bg-gray-100 text-gray-400'}`}>💎 索取 (-3)</button>
                </div>
                <input 
                  placeholder="区域（可选）" 
                  className="w-full bg-gray-50 p-4 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#5F743A]/10" 
                  value={postForm.area || ''} 
                  onChange={e => setPostForm({...postForm, area: e.target.value})}
                />
                <textarea 
                  placeholder="详情描述..." 
                  className="w-full h-32 bg-gray-50 p-4 rounded-2xl text-xs outline-none resize-none focus:ring-2 focus:ring-[#5F743A]/10" 
                  value={postForm.desc} 
                  onChange={e => setPostForm({...postForm, desc: e.target.value})}
                />
                <button 
                  disabled={isSubmitting} 
                  onClick={handlePublish} 
                  className="w-full py-5 bg-[#5F743A] text-white rounded-2xl font-black shadow-lg disabled:opacity-50 hover:bg-[#4d5e2e] transition-all"
                >
                  {isSubmitting ? '能量同步中...' : '确认发布'}
                </button>
              </div>
            )}

            {/* 2. 详情 Modal */}
            {activeModal === 'detail' && selectedItem && (
              <div className="text-center space-y-6">
                <span className="text-[10px] font-black text-[#5F743A] uppercase tracking-widest">{selectedItem.type === 'offer' ? '赠予' : '索取'}</span>
                <h3 className="text-2xl font-black text-gray-800">{selectedItem.title}</h3>
                <p className="text-sm text-gray-500 italic bg-gray-50 p-8 rounded-[2.5rem] text-left">"{selectedItem.description}"</p>
                <button onClick={() => setActiveModal('chat')} className="w-full py-5 bg-[#5F743A] text-white rounded-2xl font-black shadow-xl hover:bg-[#4d5e2e] transition-all">发起沟通</button>
              </div>
            )}

            {/* 3. 编辑 Modal */}
            {activeModal === 'edit' && editingItem && (
              <div className="space-y-5">
                <h3 className="text-xl font-black text-[#5F743A] italic">编辑萤火</h3>
                <input 
                  placeholder="标题" 
                  className="w-full bg-gray-50 p-4 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#5F743A]/10" 
                  value={editForm.title} 
                  onChange={e => setEditForm({...editForm, title: e.target.value})}
                />
                <div className="flex gap-2">
                  <button onClick={() => setEditForm({...editForm, type:'offer'})} className={`flex-1 py-3 rounded-xl text-xs font-bold ${editForm.type==='offer' ? 'bg-[#5F743A] text-white' : 'bg-gray-100 text-gray-400'}`}>🌿 赠予</button>
                  <button onClick={() => setEditForm({...editForm, type:'seek'})} className={`flex-1 py-3 rounded-xl text-xs font-bold ${editForm.type==='seek' ? 'bg-[#5F743A] text-white' : 'bg-gray-100 text-gray-400'}`}>💎 索取</button>
                </div>
                <input 
                  placeholder="区域" 
                  className="w-full bg-gray-50 p-4 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#5F743A]/10" 
                  value={editForm.area || ''} 
                  onChange={e => setEditForm({...editForm, area: e.target.value})}
                />
                <textarea 
                  placeholder="详情描述..." 
                  className="w-full h-32 bg-gray-50 p-4 rounded-2xl text-xs outline-none resize-none focus:ring-2 focus:ring-[#5F743A]/10" 
                  value={editForm.desc} 
                  onChange={e => setEditForm({...editForm, desc: e.target.value})}
                  maxLength={500}
                />
                <button 
                  disabled={isSubmitting} 
                  onClick={handleUpdateItem} 
                  className="w-full py-5 bg-[#5F743A] text-white rounded-2xl font-black shadow-lg disabled:opacity-50 hover:bg-[#4d5e2e] transition-colors"
                >
                  {isSubmitting ? '更新中...' : '确认修改'}
                </button>
              </div>
            )}

            {/* 4. Auth Modal */}
            {activeModal === 'auth' && (
              <div className="space-y-6">
                <h3 className="text-xl font-black text-[#5F743A] italic">
                  {authForm.isLogin ? '欢迎回来' : '加入社区'}
                </h3>
                <div className="space-y-4">
                  <input
                    type="email"
                    placeholder="邮箱地址"
                    className="w-full bg-gray-50 p-4 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#5F743A]/10"
                    value={authForm.email}
                    onChange={e => setAuthForm({...authForm, email: e.target.value})}
                  />
                  <input
                    type="password"
                    placeholder="密码"
                    className="w-full bg-gray-50 p-4 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-[#5F743A]/10"
                    value={authForm.password}
                    onChange={e => setAuthForm({...authForm, password: e.target.value})}
                  />
                </div>
                <button 
                  disabled={isSubmitting}
                  onClick={handleAuth}
                  className="w-full py-5 bg-[#5F743A] text-white rounded-2xl font-black shadow-lg hover:bg-[#4d5e2e] transition-colors"
                >
                  {isSubmitting ? '处理中...' : (authForm.isLogin ? '登录' : '注册')}
                </button>
                <div className="text-center">
                  <button 
                    onClick={() => setAuthForm(p => ({...p, isLogin: !p.isLogin}))}
                    className="text-xs text-gray-400 hover:text-[#5F743A] font-bold"
                  >
                    {authForm.isLogin ? '还没有账号？去注册' : '已有账号？去登录'}
                  </button>
                </div>
              </div>
            )}

            {/* 5. Chat Modal */}
            {activeModal === 'chat' && (
              <div className="flex flex-col h-full">
                <div className="text-center border-b border-gray-100 pb-4 mb-4">
                  <h3 className="text-lg font-black text-[#5F743A] truncate px-8">
                    {selectedItem?.title}
                  </h3>
                  <span className="text-[10px] text-gray-400">
                    与 {selectedItem?.user_id === user?.id ? '自己' : '邻居'} 的对话
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4">
                  {isLoadingMessages ? (
                    <div className="flex justify-center py-10">
                       <div className="w-6 h-6 border-2 border-[#5F743A] border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="text-center py-10 text-gray-300 text-xs italic">
                      👋 打个招呼，开始沟通吧
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isMe = msg.sender_id === user?.id;
                      return (
                        <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] p-3 px-4 text-xs font-medium leading-relaxed ${
                            isMe 
                              ? 'bg-[#5F743A] text-white rounded-2xl rounded-tr-sm' 
                              : 'bg-gray-100 text-gray-800 rounded-2xl rounded-tl-sm'
                          }`}>
                            {msg.content}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  <input
                    className="flex-1 bg-gray-50 p-3 rounded-xl text-xs outline-none focus:ring-1 focus:ring-[#5F743A]/20"
                    placeholder="发送消息..."
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !isSubmitting && handleSendMessage()}
                  />
                  <button
                    disabled={isSubmitting || !messageInput.trim()}
                    onClick={handleSendMessage}
                    className="px-4 bg-[#5F743A] text-white rounded-xl text-xs font-black disabled:opacity-50 hover:bg-[#4d5e2e]"
                  >
                    发送
                  </button>
                </div>
              </div>
            )}

            {/* 6. City Modal */}
            {activeModal === 'city' && (
              <div className="space-y-6">
                <h3 className="text-xl font-black text-[#5F743A] italic">切换感应城市</h3>
                <div className="grid grid-cols-2 gap-4">
                  {POPULAR_CITIES.map(city => (
                    <button 
                      key={city} 
                      onClick={() => { setCurrentCity(city); setActiveModal(null); }} 
                      className={`py-4 rounded-2xl text-xs font-black transition-all ${
                        currentCity === city 
                          ? 'bg-[#5F743A] text-white shadow-lg scale-105' 
                          : 'bg-gray-50 text-gray-400 hover:bg-gray-100'
                      }`}
                    >
                      {city}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 7. Profile Modal */}
            {activeModal === 'profile' && (
              <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
                <div className="text-center">
                  <h3 className="text-xl font-black text-[#5F743A]">邻里名片</h3>
                  <div className="bg-[#F2F6E9] p-4 rounded-2xl mt-4">
                    <p className="text-[10px] font-black text-[#5F743A] uppercase mb-1">Current Balance</p>
                    <p className="text-sm font-black text-[#5F743A]">⚡ {energy} 能量</p>
                    <p className="text-[10px] text-gray-400 truncate mt-1">{user?.email}</p>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <h4 className="text-sm font-black text-gray-800 mb-4">我的发布</h4>
                  {isLoadingUserItems ? (
                    <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-[#5F743A] border-t-transparent rounded-full animate-spin"></div></div>
                  ) : userItems.length === 0 ? (
                    <div className="text-center py-4 text-gray-400 text-xs italic">暂无发布</div>
                  ) : (
                    <div className="space-y-3">
                      {userItems.map(item => (
                        <div key={item.id} className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                           <div className="flex justify-between items-start mb-2">
                             <div>
                               <span className={`text-[9px] px-2 py-0.5 rounded-full mr-2 ${item.status==='active'?'bg-green-100 text-green-700':'bg-gray-200 text-gray-500'}`}>{item.status==='active'?'Active':'Closed'}</span>
                               <span className="text-xs font-black">{item.title}</span>
                             </div>
                           </div>
                           <div className="flex gap-2 mt-2">
                             <button onClick={() => handleEditItem(item)} disabled={item.status!=='active'} className="flex-1 py-2 bg-white border border-gray-200 rounded-lg text-[10px] font-bold hover:bg-gray-50 disabled:opacity-50">编辑</button>
                             <button onClick={() => handleDeleteItem(item)} className="flex-1 py-2 bg-red-50 text-red-500 rounded-lg text-[10px] font-bold hover:bg-red-100">管理</button>
                           </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={handleSignOut} className="w-full py-4 bg-red-50 text-red-500 rounded-2xl font-black text-xs hover:bg-red-100">退出登录</button>
              </div>
            )}

            {/* 8. Inbox Modal */}
            {activeModal === 'inbox' && (
              <div className="text-center py-20">
                <p className="text-xs text-gray-300 font-black italic">
                  信箱功能开发中... <br/>
                  请通过物品详情页发起聊天
                </p>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}