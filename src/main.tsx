import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

// Keep every device on the latest deploy without a manual cache clear. The PWA registers the service
// worker itself (autoUpdate + skipWaiting + clientsClaim); here we just (1) poll for a new worker
// every 60s so an open/installed app picks up a deploy promptly, and (2) reload once the new worker
// takes control — so a deploy reaches users within ~a minute instead of serving stale code.
if ('serviceWorker' in navigator) {
  // Was the page already controlled at startup? If not, this is a first install (or a fresh, already-
  // current load) — the first controllerchange is the initial claim, NOT a new deploy, so don't reload.
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
  navigator.serviceWorker.ready
    .then((reg) => {
      window.setInterval(() => void reg.update().catch(() => {}), 60_000)
    })
    .catch(() => {})
}
