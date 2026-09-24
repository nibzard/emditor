// ABOUTME: Browser entry point of the emditor web app.
// ABOUTME: It loads the fonts and styles and mounts the root component.

import '@fontsource-variable/source-serif-4/wght.css'
import '@fontsource-variable/source-serif-4/wght-italic.css'
import './styles.css'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
