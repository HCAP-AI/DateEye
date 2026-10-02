import * as SecureStore from 'expo-secure-store';
import { createClient, type Session } from './session-client';
const KEY='prod.session.v1';
export const api=createClient(process.env.EXPO_PUBLIC_API_URL || 'https://prod-plan.com',{
  async read() { const value=await SecureStore.getItemAsync(KEY); if(!value)return null; try {const s=JSON.parse(value) as Session;if(typeof s.accessToken==='string' && typeof s.refreshToken==='string' && typeof s.expiresAt==='number')return s;}catch{}await SecureStore.deleteItemAsync(KEY);return null; },
  async write(value) { await SecureStore.setItemAsync(KEY,JSON.stringify(value),{keychainAccessible:SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY}); },
  async clear() { await SecureStore.deleteItemAsync(KEY); }
});
