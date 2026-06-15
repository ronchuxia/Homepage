import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Chat from './pages/Chat'
import Notes from './pages/Notes'
import Canvas from './pages/Canvas'

function AnimatedRoutes() {
  const location = useLocation()
  // Key on the top-level segment only, so switching pages animates but
  // navigating within a page (e.g. between notes) does not re-trigger it.
  const pageKey = `/${location.pathname.split('/')[1] || ''}`

  return (
    <div key={pageKey} className="animate-page-in motion-reduce:animate-none">
      <Routes location={location}>
        <Route path="/" element={<Chat />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/notes/*" element={<Notes />} />
        <Route path="/canvas/*" element={<Canvas />} />
      </Routes>
    </div>
  )
}

function App() {
  return (
    <Router>
      <Navbar />
      <AnimatedRoutes />
    </Router>
  )
}

export default App
