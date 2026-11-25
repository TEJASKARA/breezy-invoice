import { createClient } from "@supabase/supabase-js"

import { clearSignedInBrowserData } from "@/lib/session-cleanup"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

// Sign-out (including an expired or revoked session, or sign-out in another tab) and
// opening the app with no session both wipe personal data kept in this browser.
supabase?.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) clearSignedInBrowserData()
})
