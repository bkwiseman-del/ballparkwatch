import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import Home from './routes/Home'
import Login from './routes/Login'
import Setup from './routes/Setup'
import Lineup from './routes/Lineup'
import Score from './routes/Score'
import Watch from './routes/Watch'
import Broadcast from './routes/Broadcast'
import Join from './routes/Join'
import Team from './routes/Team'

export default function App() {
  return (
    <Routes>
      {/* Public marketing landing page. */}
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route
        path="/setup"
        element={
          <RequireAuth>
            <Setup />
          </RequireAuth>
        }
      />
      <Route
        path="/lineup/:gameId"
        element={
          <RequireAuth>
            <Lineup />
          </RequireAuth>
        }
      />
      <Route
        path="/score/:gameId"
        element={
          <RequireAuth>
            <Score />
          </RequireAuth>
        }
      />
      {/* Viewer is public — reached via an unguessable share link, no account. */}
      <Route path="/watch/:gameId" element={<Watch />} />
      {/* Public team page — visibility-gated server-side (private teams 404). */}
      <Route path="/t/:slug" element={<Team />} />
      {/* Broadcaster — reached only via the scorer's private token link/QR. */}
      <Route path="/broadcast/:token" element={<Broadcast />} />
      {/* Accept a team invite — sign-in required, but NOT the beta allowlist
          (accepting the invite is what grants access). */}
      <Route path="/join/:token" element={<Join />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
