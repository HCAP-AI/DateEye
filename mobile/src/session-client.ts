export type Session = { accessToken: string; refreshToken: string; expiresAt: number };
type TokenResponse = { accessToken: string; refreshToken: string; expiresIn: number };
export type SessionStore = { read(): Promise<Session | null>; write(value: Session): Promise<void>; clear(): Promise<void> };
export class ApiError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status=status; } }
export function createClient(base: string, store: SessionStore, transport: typeof fetch = fetch) {
  const url = new URL(base);
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw Error('API address must be an HTTPS origin.');
  let refreshing: Promise<Session> | null = null;
  async function send<T>(path: string, method: string, payload?: unknown, token?: string): Promise<T> {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await transport(url.origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:controller.signal});
      const data=await response.json();
      if (!response.ok) throw new ApiError(data.error || 'Please try again.',response.status);
      return data as T;
    } finally { clearTimeout(timeout); }
  }
  async function save(data: TokenResponse) {
    if (!data.accessToken || !data.refreshToken || !Number.isFinite(data.expiresIn) || data.expiresIn<=0) throw Error('Invalid sign-in response.');
    const session={accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:Date.now()+data.expiresIn*1000};
    await store.write(session); return session;
  }
  async function refresh(session: Session) {
    if (!refreshing) refreshing=send<TokenResponse>('/api/mobile/refresh','POST',{refreshToken:session.refreshToken}).then(save).catch(async(e: unknown)=>{if(e instanceof ApiError && e.status===401) await store.clear(); throw e;}).finally(()=>{refreshing=null;});
    return refreshing;
  }
  return {
    readSession: store.read,
    clearSession: store.clear,
    sendCode: (email: string) => send('/api/send-code','POST',{email}),
    verifyCode: async(email: string, code: string) => save(await send<TokenResponse>('/api/mobile/session','POST',{email,code})),
    async request<T>(path: string, method='GET', payload?: unknown): Promise<T> {
      if (!path.startsWith('/api/') || path.startsWith('/api//')) throw Error('Invalid API path.');
      let session=await store.read();
      if (!session) throw new ApiError('Please sign in.',401);
      if (session.expiresAt<=Date.now()+60000) session=await refresh(session);
      try { return await send<T>(path,method,payload,session.accessToken); }
      catch(e) {
        if (!(e instanceof ApiError) || e.status!==401) throw e;
        session=await refresh(session);
        try { return await send<T>(path,method,payload,session.accessToken); }
        catch(retryError) { if (retryError instanceof ApiError && retryError.status===401) await store.clear(); throw retryError; }
      }
    }
  };
}
