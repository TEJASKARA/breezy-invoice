import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './lib/theme-provider.tsx'
import { supabase } from './lib/supabase'
import { configureErrorReporting, reportUnexpectedError } from './lib/error-reporting'

configureErrorReporting(async (report) => {
  if (!supabase) return
  const { data } = await supabase.auth.getSession()
  if (!data.session) return
  await supabase.rpc('chanax_report_unexpected_error', report)
})
window.addEventListener('error', (event) => {
  if (event.error) reportUnexpectedError(event.error, "An unexpected problem occurred. Please try again.")
})
window.addEventListener('unhandledrejection', (event) => {
  reportUnexpectedError(event.reason, "An unexpected problem occurred. Please try again.")
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
