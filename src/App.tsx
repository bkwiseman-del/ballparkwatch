import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './auth/RequireAuth'
import Login from './routes/Login'
import Setup from './routes/Setup'
import Lineup from './routes/Lineup'
import Score from './routes/Score'
import Watch from './routes/Watch'
import Broadcast from './routes/Broadcast'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/setup" replace />} />
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
      {/* Broadcaster — reached only via the scorer's private token link/QR. */}
      <Route path="/broadcast/:token" element={<Broadcast />} />
      <Route path="*" element={<Navigate to="/setup" replace />} />
    </Routes>
  )
}
