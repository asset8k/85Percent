'use server'

import { redirect } from 'next/navigation'
import { checkCredentials, setSession, clearSession } from '@/lib/session'

/** Sign in. On success sets the session cookie and lands on the leads inbox. */
export async function login(formData: FormData): Promise<void> {
  const username = String(formData.get('username') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  if (!checkCredentials(username, password)) {
    redirect('/login?error=1')
  }
  setSession()
  redirect('/leads')
}

export async function logout(): Promise<void> {
  clearSession()
  redirect('/login')
}
