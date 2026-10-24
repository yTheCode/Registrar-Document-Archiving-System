import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Offline-first fonts: bundled locally via @fontsource (no Google Fonts network
// requests), so type renders identically without internet connectivity.
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'

import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
