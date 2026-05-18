import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { FontScaleProvider } from './context/FontScaleContext'
import { AccentColorProvider } from './context/AccentColorContext'
import { AuthProvider } from './context/AuthContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FontScaleProvider>
      <AccentColorProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </AccentColorProvider>
    </FontScaleProvider>
  </StrictMode>,
)
