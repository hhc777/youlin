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

type ModalType = 'publish' | 'detail' | 'profile' | 'auth' | 'city' | 'edit' | null;

interface PostForm {
  title: string;
  descText: string;
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

// --- 等级配置 ---
const getReputation = (score: number) => {
  if (score <= 1) return { title: '迷路萤火', color: 'text-gray-400', canSeek: false };
  if (score <= 10) return { title: '微光邻里', color: 'text-[#5F743A]', canSeek: true };
  if (score <= 30) return { title: '能量使者', color: 'text-blue-500', canSeek: true };
  if (score <= 100) return { title: '社区之光', color: 'text-orange-500', canSeek: true };
  return { title: '永恒守护者', color: 'text-purple-600', canSeek: true };
};

const getSupabaseClient = (): SupabaseClient => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');
  return createClient(url, key);
};

export default function YouLinV2() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  
  // --- 状态 ---
  const [user, setUser] = useState<User | null>(null);
  const [energy, setEnergy] = useState<number>(0);
  const [items, setItems] = useState<Item[]>([]);
  const [currentCity, setCurrentCity] = useState<string>('上海市');
  const [currentArea, setCurrentArea] = useState<string>(''); 
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  
  const [postForm, setPostForm] = useState<PostForm>({ title: '', descText: '', type: 'offer', area: '' });
  const [authForm, setAuthForm] = useState<AuthForm>({ email: '', password: '', isLogin: true });

  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // --- 获取能量值 ---
  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('energy_score').eq('id', userId).single();
    if (!error && data) setEnergy(data.energy_score);
  }, [supabase]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        fetchProfile(session.user.id);
      }
    };
    init();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => {
      setUser(s?.user ?? null);
      if (s?.user) fetchProfile(s.user.id);
    });
    return () => subscription.unsubscribe();
  }, [supabase, fetchProfile]);

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase.from('items').select('*').eq('city', currentCity).eq('status', 'active');
      if (currentArea) query = query.ilike('area', `%${currentArea}%`);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      setItems(data as Item[]);
    } catch (e) { showToast('获取列表失败', 'error'); }
    finally { setIsLoading(false); }
  }, [currentCity, currentArea, supabase, showToast]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const reputation = useMemo(() => getReputation(energy), [energy]);

  // --- 发布功能（带权限检查） ---
  const handlePublish = async () => {
    if (!user) return setActiveModal('auth');
    
    // 权限检查逻辑
    if (postForm.type === 'seek' && !reputation.canSeek) {
      return showToast(`能量不足(当前:${energy})，无法发起需求。去通过“赠予”赚取能量吧！`, 'error');
    }

    if (!postForm.title.trim()) return showToast('请填写标题', 'error');
    
    setIsSubmitting(true);
    try {
      const { error } = await supabase.from('items').insert([{
        title: postForm.title.trim(),
        description: postForm.descText.trim(),
        type: postForm.type,
        user_id: user.id,
        city: currentCity,
        area: postForm.area?.trim() || null,
        status: 'active',
      }]);
      if (error) throw error;
      showToast('发布成功！', 'success');
      setPostForm({ title: '', descText: '', type: 'offer', area: '' });
      setActiveModal(null);
      fetchItems();
    } catch (e: any) { showToast(`发布失败: ${e.message}`, 'error'); }
    finally { setIsSubmitting(false); }
  };

  const handleAuth = async () => {
    setIsSubmitting(true);
    try {
      const { data, error } = authForm.isLogin 
        ? await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password })
        : await supabase.auth.signUp({ email: authForm.email, password: authForm.password });
      if (error) throw error;
      setUser(data.user);
      setActiveModal(null);
      showToast('操作成功', 'success');
    } catch (e: any) { showToast(e.message, 'error'); }
    finally { setIsSubmitting(false); }
  };

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#2D341E]">
      {toast && (
        <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[300] px-6 py-3 rounded-2xl shadow-xl text-xs font-black ${
          toast.type === 'success' ? 'bg-[#5F743A] text-white' : 'bg-red-500 text-white'
        }`}>{toast.message}</div>
      )}
      
      <nav className="fixed top-0 inset-x-0 h-20 bg-white/90 backdrop-blur-xl border-b border-gray-100 z-[100] px-8 flex justify-between items-center">
        <div onClick={() => setActiveModal('city')} className="cursor-pointer">
          <span className="text-[10px] font-black text-gray-300 block">Nearby</span>
          <span className="text-sm font-black text-[#5F743A]">📍 {currentCity}</span>
        </div>
        <h1 className="text-2xl font-black italic text-[#5F743A]">有邻</h1>
        <div className="flex items-center gap-6">
          {user && (
            <div className="text-right hidden sm:block">
              <p className={`text-[10px] font-black ${reputation.color}`}>{reputation.title}</p>
              <p className="text-[9px] text-gray-300">能量值: {energy}</p>
            </div>
          )}
          <button onClick={() => setActiveModal('profile')} className="text-2xl">👤</button>
          <button onClick={() => user ? setActiveModal('publish') : setActiveModal('auth')} className="bg-[#5F743A] text-white px-6 py-2 rounded-full text-xs font-black">播撒萤火</button>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-8 pt-32">
        <div className="mb-8 flex gap-3">
          <input placeholder="搜索区域..." value={currentArea} onChange={e => setCurrentArea(e.target.value)} className="flex-1 bg-white p-3 rounded-xl text-xs border border-gray-100 outline-none" />
        </div>

        {isLoading ? <div className="text-center py-20 font-black text-gray-400">感应中...</div> : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {items.map(item => (
              <div key={item.id} onClick={() => { setSelectedItem(item); setActiveModal('detail'); }} className="bg-white p-8 rounded-[3rem] border border-gray-100 hover:shadow-xl cursor-pointer">
                <span className={`text-[9px] font-black px-2 py-1 rounded-full ${item.type === 'offer' ? 'bg-[#F2F6E9] text-[#5F743A]' : 'bg-blue-50 text-blue-500'}`}>
                  {item.type === 'offer' ? '🌿 赠予' : '💎 需求'}
                </span>
                <h3 className="text-lg font-black mt-2">{item.title}</h3>
                <p className="text-xs text-gray-400 italic line-clamp-2 mt-2">"{item.description}"</p>
                {item.area && <p className="text-[10px] text-gray-300 mt-2">📍 {item.area}</p>}
              </div>
            ))}
          </div>
        )}
      </main>

      {activeModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-md" onClick={() => setActiveModal(null)} />
          <div className="relative bg-white w-full max-w-sm rounded-[3rem] p-10 shadow-2xl">
            <button onClick={() => setActiveModal(null)} className="absolute top-8 right-8 text-gray-300">✕</button>

            {activeModal === 'publish' && (
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <h2 className="text-xl font-black text-[#5F743A]">播撒萤火</h2>
                  <span className={`text-[10px] font-bold ${reputation.color}`}>{reputation.title} (能量:{energy})</span>
                </div>
                
                <div className="flex gap-2">
                  <button onClick={() => setPostForm({...postForm, type:'offer'})} className={`flex-1 py-3 rounded-xl text-xs font-bold ${postForm.type==='offer'?'bg-[#5F743A] text-white':'bg-gray-100'}`}>🌿 赠予</button>
                  <button onClick={() => setPostForm({...postForm, type:'seek'})} className={`flex-1 py-3 rounded-xl text-xs font-bold ${postForm.type==='seek'?'bg-blue-500 text-white':'bg-gray-100'}`}>💎 需求</button>
                </div>
                
                {postForm.type === 'seek' && !reputation.canSeek && (
                  <p className="text-[10px] text-red-400 font-bold bg-red-50 p-2 rounded-lg">⚠️ 你的称号等级不足以发起“需求”，请尝试“赠予”来增加能量。</p>
                )}

                <input placeholder="标题" value={postForm.title} onChange={e => setPostForm({...postForm, title: e.target.value})} className="w-full bg-gray-50 p-4 rounded-2xl text-xs font-bold outline-none" />
                <input placeholder="区域（如：静安区）" value={postForm.area} onChange={e => setPostForm({...postForm, area: e.target.value})} className="w-full bg-gray-50 p-4 rounded-2xl text-xs font-bold outline-none" />
                <textarea placeholder="详情描述..." value={postForm.descText} onChange={e => setPostForm({...postForm, descText: e.target.value})} className="w-full h-32 bg-gray-50 p-4 rounded-2xl text-xs outline-none" />
                <button disabled={isSubmitting} onClick={handlePublish} className="w-full py-5 bg-[#5F743A] text-white rounded-2xl font-black shadow-lg hover:scale-[1.02] transition-transform">{isSubmitting?'传播中...':'确认发布'}</button>
              </div>
            )}

            {activeModal === 'auth' && (
              <div className="space-y-4">
                <h2 className="text-xl font-black text-[#5F743A]">{authForm.isLogin?'欢迎回来':'加入邻里'}</h2>
                <input placeholder="邮箱" value={authForm.email} onChange={e => setAuthForm({...authForm, email: e.target.value})} className="w-full bg-gray-50 p-4 rounded-2xl text-xs outline-none" />
                <input type="password" placeholder="密码" value={authForm.password} onChange={e => setAuthForm({...authForm, password: e.target.value})} className="w-full bg-gray-50 p-4 rounded-2xl text-xs outline-none" />
                <button onClick={handleAuth} className="w-full py-5 bg-[#5F743A] text-white rounded-2xl font-black shadow-lg">{authForm.isLogin?'登录':'注册'}</button>
                <p onClick={() => setAuthForm({...authForm, isLogin: !authForm.isLogin})} className="text-center text-[10px] text-gray-400 cursor-pointer">{authForm.isLogin?'新伙伴？点击注册':'已有账号？点击登录'}</p>
              </div>
            )}

            {activeModal === 'detail' && selectedItem && (
              <div className="text-center space-y-6">
                <span className={`text-[10px] font-black px-4 py-1 rounded-full ${selectedItem.type === 'offer' ? 'bg-[#F2F6E9] text-[#5F743A]' : 'bg-blue-50 text-blue-500'}`}>
                  {selectedItem.type === 'offer' ? '🌿 赠予' : '💎 需求'}
                </span>
                <h3 className="text-2xl font-black">{selectedItem.title}</h3>
                <p className="text-sm text-gray-500 italic bg-gray-50 p-6 rounded-2xl">"{selectedItem.description}"</p>
                <button className="w-full py-5 bg-[#5F743A] text-white rounded-2xl font-black shadow-xl">发起沟通</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}