'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import crypto from 'node:crypto';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/auth';

/** Constant-time string comparison to avoid leaking length/content via timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export async function login(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');

  const validUser = process.env.APP_USERNAME ?? '';
  const validPass = process.env.APP_PASSWORD ?? '';

  if (!validUser || !validPass) {
    return 'Login is not configured. Set APP_USERNAME and APP_PASSWORD.';
  }
  if (!safeEqual(username, validUser) || !safeEqual(password, validPass)) {
    return 'Incorrect username or password.';
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, createSessionToken(username), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });

  redirect('/');
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  redirect('/login');
}
