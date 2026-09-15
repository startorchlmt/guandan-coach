import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

// 用 HashRouter：子路径静态托管（GitHub Pages /guandan-coach/）下路由不受路径影响
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)

// PWA：生产环境注册 Service Worker（离线缓存）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* 非安全上下文（如局域网 HTTP）下静默失败 */ })
  })
}
