import { useEffect, useRef, useState } from 'react'
// 同步保存浏览器草稿；数据库请求串行，失败保留草稿供重新打开恢复。
export function draftValue<T>(key: string, fallback: T): T {
  try { const raw=localStorage.getItem(key); return raw===null?fallback:JSON.parse(raw) } catch { return fallback }
}
export function useSafeDraft(key: string | null, value: unknown, persist: () => Promise<unknown>) {
 const callback=useRef(persist); callback.current=persist
 const busy=useRef(false), previous=useRef(''), active=useRef<string|null>(null)
 const [status,setStatus]=useState('草稿保护已开启')
 const encoded=JSON.stringify(value)
 useEffect(()=>{
  if(!key)return
  if(active.current!==key){active.current=key;previous.current=encoded;setStatus('草稿保护已开启');return}
  if(encoded===previous.current)return
  try{localStorage.setItem(key,encoded);setStatus('草稿已保存，等待写入数据库…')}catch{setStatus('浏览器草稿保存失败，请立即手动保存')}
  let cancelled=false
  const saveSnapshot=callback.current
  const timer=setTimeout(async()=>{
   while(busy.current){await new Promise(resolve=>setTimeout(resolve,100));if(cancelled)return}
   if(cancelled)return
   busy.current=true
   try{await saveSnapshot();if(!cancelled){previous.current=encoded;if(localStorage.getItem(key)===encoded)localStorage.removeItem(key);setStatus('✓ 已保存到数据库')}}catch{if(!cancelled)setStatus('数据库保存失败，草稿保留；继续输入或手动保存重试')}finally{busy.current=false}
  },1200)
  return ()=>{cancelled=true;clearTimeout(timer)}
 },[key,encoded,status==='__retry__'])
 return status
}
