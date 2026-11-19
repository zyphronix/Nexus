'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { claimPendingInvitations } from '@/core/db/queries'

function safeNext(raw: FormDataEntryValue | null): string {
  const value = typeof raw === 'string' ? raw : ''
  if (value.startsWith('/') && !value.startsWith('//')) return value
  return '/dashboard'
}

function normalizeAuthErrorMessage(error: { message?: string; status?: number } | null | undefined, fallback: string): string {
  const message = error?.message?.toLowerCase() || ''

  if (message.includes('unsupported provider') || message.includes('provider is not enabled')) {
    return 'Google sign-in is not enabled in Supabase Auth. Enable the Google provider in your Supabase dashboard.'
  }

  if (message.includes('rate limit') || message.includes('email rate limit')) {
    return 'Email sign-up is temporarily rate-limited. Wait a few minutes and try again, or use a different email address.'
  }

  return fallback
}

export async function login(formData: FormData) {
  const supabase = await createClient()
  const next = safeNext(formData.get('next'))

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  }

  const { error } = await supabase.auth.signInWithPassword(data)

  if (error) {
    console.error("Supabase Login Error:", error)
    const qs = new URLSearchParams({ error: error.message || 'Could not authenticate user' })
    if (next !== '/dashboard') qs.set('next', next)
    redirect(`/sign-in?${qs.toString()}`)
  }

  revalidatePath('/', 'layout')
  redirect(next)
}

export async function signInWithGoogle(formData: FormData) {
  const supabase = await createClient()
  const origin = (await headers()).get('origin')
  const next = safeNext(formData.get('next'))

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (error) {
    console.error("Google Login Error:", error)
    const message = normalizeAuthErrorMessage(error, 'Could not authenticate with Google')
    redirect(`/sign-in?error=${encodeURIComponent(message)}`)
  }

  if (data.url) {
    redirect(data.url)
  }
}

export async function signup(formData: FormData) {
  const supabase = await createClient()
  const next = safeNext(formData.get('next'))

  const data = {
    email: formData.get('email') as string,
    password: formData.get('password') as string,
    name: formData.get('name') as string,
  }

  const { data: authData, error } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        full_name: data.name,
      }
    }
  })

  if (error) {
    console.error("Supabase Signup Error:", error)
    const qs = new URLSearchParams({
      error: normalizeAuthErrorMessage(error, 'Could not authenticate user'),
    })
    if (next !== '/dashboard') qs.set('next', next)
    redirect(`/sign-up?${qs.toString()}`)
  }

  // Insert the user into the public schema's `users` table since there
  // are no triggers enabled setup by default
  const user = authData?.user;
  if (user) {
    const { error: insertError } = await supabase.from('users').insert({
      id: user.id,
      email: data.email,
      name: data.name,
    });

    if (insertError) {
      console.error("Failed to sync user to public table:", insertError);
    }

    try {
      await claimPendingInvitations(user.id, data.email);
    } catch (claimError) {
      console.error("Failed to claim pending invitations:", claimError);
    }
  }

  revalidatePath('/', 'layout')
  redirect(next)
}
