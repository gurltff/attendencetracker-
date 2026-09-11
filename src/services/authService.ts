import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth'

import { auth, isFirebaseConfigured } from './firebase'
import { getById, put } from './store'
import type { Role, UserProfile } from '../types'

export const LOCAL_AUTH_KEY = 'sat_local_auth_uid'
export const LOCAL_USERS_KEY = 'sat_local_users'
export const DEMO_MODE_KEY = 'sat_demo_mode'

function now() {
  return Date.now()
}

function getLocalUsers(): Record<
  string,
  UserProfile & { password: string }
> {
  try {
    const raw = localStorage.getItem(LOCAL_USERS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveLocalUsers(
  users: Record<string, UserProfile & { password: string }>
) {
  localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users))
}

export function isDemoMode() {
  return localStorage.getItem(DEMO_MODE_KEY) === '1'
}

export function getLocalCurrentUid() {
  return localStorage.getItem(LOCAL_AUTH_KEY)
}

export function getLocalCurrentUser(): UserProfile | null {
  const uid = getLocalCurrentUid()

  if (!uid) return null

  const entry = getLocalUsers()[uid]

  if (!entry) return null

  const { password: _password, ...profile } = entry

  try {
    const raw = localStorage.getItem('sat_users')

    const storedUsers = raw
      ? (JSON.parse(raw) as UserProfile[])
      : []

    const storedProfile = storedUsers.find(
      (item) => item.uid === uid
    )

    if (storedProfile) {
      return {
        ...profile,
        ...storedProfile,
        uid,
        email: storedProfile.email ?? profile.email,
        name: storedProfile.name ?? profile.name,
      }
    }
  } catch {
    // Fall back to local auth profile.
  }

  return profile
}

export function syncLocalUserProfile(
  profile: UserProfile
) {
  const users = getLocalUsers()
  const existing = users[profile.uid]

  if (!existing) return

  users[profile.uid] = {
    ...existing,
    ...profile,
    password: existing.password,
  }

  saveLocalUsers(users)
}

function setLocalCurrentUid(uid: string | null) {
  if (uid) {
    localStorage.setItem(LOCAL_AUTH_KEY, uid)
  } else {
    localStorage.removeItem(LOCAL_AUTH_KEY)
  }
}

export function setDemoMode(enabled: boolean) {
  if (enabled) {
    localStorage.setItem(DEMO_MODE_KEY, '1')
  } else {
    localStorage.removeItem(DEMO_MODE_KEY)
  }
}

export function notifyLocalAuthChanged() {
  window.dispatchEvent(
    new Event('sat-auth-changed')
  )
}

function validateRole(role: Role) {
  if (!['student', 'teacher', 'cr'].includes(role)) {
    throw new Error('Invalid user role.')
  }
}

export async function signUp(
  name: string,
  email: string,
  password: string,
  role: Role,
  options?: {
    enrolledCourseIds?: string[]
    assignedCourseIds?: string[]
    year?: string
  }
): Promise<UserProfile> {
  validateRole(role)

  if (role === 'cr') {
    throw new Error(
      'CR accounts cannot be registered directly. A teacher must assign CR status.'
    )
  }

  const cleanName = name.trim()
  const cleanEmail = email.trim().toLowerCase()

  if (!cleanName) {
    throw new Error('Please enter your full name.')
  }

  if (!cleanEmail) {
    throw new Error('Please enter your email address.')
  }

  if (password.length < 6) {
    throw new Error(
      'Password must be at least 6 characters.'
    )
  }

  if (!isFirebaseConfigured || isDemoMode()) {
    const users = getLocalUsers()

    if (
      Object.values(users).some(
        (u) =>
          u.email.toLowerCase() === cleanEmail
      )
    ) {
      throw new Error(
        'An account with this email already exists.'
      )
    }

    const uid = `local_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`

    const profile: UserProfile = {
      uid,
      name: cleanName,
      email: cleanEmail,
      role,
      enrolledCourseIds:
        options?.enrolledCourseIds,
      assignedCourseIds:
        options?.assignedCourseIds,
      year: options?.year,
      createdAt: now(),
    }

    users[uid] = {
      ...profile,
      password,
    }

    saveLocalUsers(users)

    if (isDemoMode()) {
      setLocalCurrentUid(uid)
      notifyLocalAuthChanged()
    }

    return profile
  }

  if (!auth) {
    throw new Error(
      'Firebase authentication is not configured.'
    )
  }

  const credential =
    await createUserWithEmailAndPassword(
      auth,
      cleanEmail,
      password
    )

  const profile: UserProfile = {
    uid: credential.user.uid,
    name: cleanName,
    email: cleanEmail,
    role,
    enrolledCourseIds:
      options?.enrolledCourseIds,
    assignedCourseIds:
      options?.assignedCourseIds,
    year: options?.year,
    createdAt: now(),
  }

  await put<UserProfile & { id: string }>(
    'users',
    {
      ...profile,
      id: profile.uid,
    }
  )

  return profile
}

export async function logIn(
  email: string,
  password: string
): Promise<UserProfile> {
  const cleanEmail = email.trim().toLowerCase()

  if (!cleanEmail || !password) {
    throw new Error(
      'Please enter your email and password.'
    )
  }

  if (isDemoMode()) {
    const entry = Object.values(
      getLocalUsers()
    ).find(
      (u) =>
        u.email.toLowerCase() === cleanEmail
    )

    if (
      !entry ||
      entry.password !== password
    ) {
      throw new Error(
        'Invalid demo email or password.'
      )
    }

    setLocalCurrentUid(entry.uid)
    notifyLocalAuthChanged()

    const {
      password: _password,
      ...profile
    } = entry

    return profile
  }

  if (!isFirebaseConfigured) {
    const entry = Object.values(
      getLocalUsers()
    ).find(
      (u) =>
        u.email.toLowerCase() === cleanEmail
    )

    if (
      !entry ||
      entry.password !== password
    ) {
      throw new Error(
        'Invalid email or password.'
      )
    }

    setLocalCurrentUid(entry.uid)
    notifyLocalAuthChanged()

    const {
      password: _password,
      ...profile
    } = entry

    return profile
  }

  if (!auth) {
    throw new Error(
      'Firebase authentication is not configured.'
    )
  }

  const credential =
    await signInWithEmailAndPassword(
      auth,
      cleanEmail,
      password
    )

  const profile =
    await getById<UserProfile>(
      'users',
      credential.user.uid
    )

  if (!profile) {
    await signOut(auth)

    throw new Error(
      'Your authentication account exists, but your Smart Attendance profile is missing.'
    )
  }

  return profile
}

/*
 * Demo login
 */
export async function logInDemo(
  email: string,
  password: string
): Promise<UserProfile> {
  setDemoMode(true)

  if (isFirebaseConfigured && auth) {
    try {
      await signOut(auth)
    } catch {
      // Already signed out.
    }
  }

  return logIn(email, password)
}

/*
 * Firebase forgot-password
 *
 * Demo accounts intentionally do not use Firebase
 * password reset because demo accounts are local.
 */
export async function resetPassword(
  email: string
): Promise<void> {
  const cleanEmail = email.trim().toLowerCase()

  if (!cleanEmail) {
    throw new Error(
      'Please enter your email address.'
    )
  }

  if (isDemoMode()) {
    throw new Error(
      'Password reset is not available for Demo Mode. Use a real Firebase account.'
    )
  }

  if (!isFirebaseConfigured) {
    throw new Error(
      'Firebase is not configured.'
    )
  }

  if (!auth) {
    throw new Error(
      'Firebase authentication is not configured.'
    )
  }

  await sendPasswordResetEmail(
    auth,
    cleanEmail
  )
}

/*
 * Logout
 */
export async function logOut(): Promise<void> {
  if (isDemoMode()) {
    setLocalCurrentUid(null)
    setDemoMode(false)
    notifyLocalAuthChanged()
    return
  }

  if (!isFirebaseConfigured) {
    setLocalCurrentUid(null)
    notifyLocalAuthChanged()
    return
  }

  if (!auth) {
    throw new Error(
      'Firebase authentication is not configured.'
    )
  }

  await signOut(auth)
}

/*
 * Authentication watcher
 */
export function watchAuthState(
  callback: (uid: string | null) => void
): () => void {
  const localHandler = () => {
    if (
      isDemoMode() ||
      !isFirebaseConfigured
    ) {
      callback(getLocalCurrentUid())
    }
  }

  window.addEventListener(
    'sat-auth-changed',
    localHandler
  )

  if (!isFirebaseConfigured || !auth) {
    callback(getLocalCurrentUid())

    return () =>
      window.removeEventListener(
        'sat-auth-changed',
        localHandler
      )
  }

  const unsubscribe =
    onAuthStateChanged(
      auth,
      (firebaseUser: FirebaseUser | null) => {
        if (isDemoMode()) {
          callback(
            getLocalCurrentUid()
          )
          return
        }

        callback(
          firebaseUser?.uid ?? null
        )
      }
    )

  return () => {
    unsubscribe()

    window.removeEventListener(
      'sat-auth-changed',
      localHandler
    )
  }
}

/*
 * Demo account compatibility helper
 */
export async function ensureDemoAccount(
  name: string,
  email: string,
  password: string,
  role: 'student' | 'teacher',
  options?: {
    enrolledCourseIds?: string[]
    assignedCourseIds?: string[]
    year?: string
  }
): Promise<UserProfile> {
  const users = getLocalUsers()

  const existing = Object.values(
    users
  ).find(
    (u) =>
      u.email.toLowerCase() ===
      email.trim().toLowerCase()
  )

  if (existing) {
    const updated: UserProfile = {
      ...existing,
      name,
      email: email
        .trim()
        .toLowerCase(),
      role,
      enrolledCourseIds:
        options?.enrolledCourseIds ??
        existing.enrolledCourseIds,
      assignedCourseIds:
        options?.assignedCourseIds ??
        existing.assignedCourseIds,
      year:
        options?.year ??
        existing.year,
    }

    users[existing.uid] = {
      ...updated,
      password: existing.password,
    }

    saveLocalUsers(users)

    return updated
  }

  const uid = `demo_${email
    .split('@')[0]
    .replace(/[^a-z0-9]/gi, '_')}`

  const profile: UserProfile = {
    uid,
    name,
    email: email.trim().toLowerCase(),
    role,
    enrolledCourseIds:
      options?.enrolledCourseIds,
    assignedCourseIds:
      options?.assignedCourseIds,
    year: options?.year,
    createdAt: now(),
  }

  users[uid] = {
    ...profile,
    password,
  }

  saveLocalUsers(users)

  return profile
}