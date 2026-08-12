import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider, SignedIn, SignedOut, SignIn } from '@clerk/clerk-react'
import App from './App.jsx'

// Vantage holds customer contact details, so it sits behind a real login rather
// than the shared team key, which was compiled into the bundle and readable by
// anyone who opened the app.
const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

// Clerk's default palette would clash; matching the app keeps the login feeling
// like part of Vantage rather than a third-party interruption.
const appearance = {
  variables: {
    colorPrimary: '#1C2D5E',
    colorText: '#1C2D5E',
    borderRadius: '8px',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
}

function SignInScreen() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 28,
      background: '#F7F9FC', padding: 24,
      paddingTop: 'calc(24px + env(safe-area-inset-top))',
      fontFamily: appearance.variables.fontFamily,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9, background: '#1C2D5E',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#fff', fontWeight: 900, fontSize: 19, fontFamily: 'monospace' }}>V</span>
        </div>
        <div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#1C2D5E', letterSpacing: -0.4 }}>Vantage</div>
          <div style={{ fontSize: 12, color: '#8C95A0' }}>by ClickDocs</div>
        </div>
      </div>
      <SignIn appearance={appearance} routing="hash" />
    </div>
  )
}

// Without a key the app renders blank with only a console error, which reads as
// a crash. Say what's actually wrong.
function MissingKey() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, fontFamily: appearance.variables.fontFamily, color: '#4A5568', textAlign: 'center',
    }}>
      <div style={{ maxWidth: 420, lineHeight: 1.6 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1C2D5E', marginBottom: 8 }}>
          Sign-in is not configured
        </div>
        VITE_CLERK_PUBLISHABLE_KEY is missing from this build. Set it in Netlify's
        environment variables and redeploy.
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {CLERK_KEY ? (
      <ClerkProvider publishableKey={CLERK_KEY} appearance={appearance}>
        <BrowserRouter>
          <SignedIn><App /></SignedIn>
          <SignedOut><SignInScreen /></SignedOut>
        </BrowserRouter>
      </ClerkProvider>
    ) : (
      <MissingKey />
    )}
  </React.StrictMode>,
)
