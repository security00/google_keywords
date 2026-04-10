import "server-only";

import {
  randomBytes,
  scrypt as _scrypt,
  type ScryptOptions,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import { d1Query } from "@/lib/d1";

export type AuthUser = {
  id: string;
  email: string;
  role?: string;
};

type AuthUserRow = AuthUser & {
  password_hash: string;
};

type AuthSessionRow = {
  user_id: string;
  email: string;
  role?: string;
  expires_at: string;
};

const scrypt = (
  password: string,
  salt: string,
  options: ScryptOptions
) =>
  new Promise<Buffer>((resolve, reject) => {
    _scrypt(password, salt, SCRYPT_KEYLEN, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });

const SESSION_DAYS = 7;
export const SESSION_COOKIE_NAME =
  process.env.AUTH_SESSION_COOKIE ?? "kr_session";
const COOKIE_SECURE =
  process.env.AUTH_COOKIE_SECURE !== undefined
    ? process.env.AUTH_COOKIE_SECURE === "true"
    : process.env.NODE_ENV === "production";
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEYLEN = 64;
const buildScryptOptions = (
  cost: number,
  blockSize: number,
  parallelization: number
): ScryptOptions => ({
  N: cost,
  r: blockSize,
  p: parallelization,
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const hashSessionToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const createPasswordHash = async (password: string) => {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(
    password,
    salt,
    buildScryptOptions(SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION)
  );

  const hash = derived.toString("base64url");
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt}$${hash}`;
};

const verifyPassword = async (password: string, stored: string) => {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;
  const [prefix, costRaw, blockSizeRaw, parallelizationRaw, salt, hash] = parts;
  if (prefix !== "scrypt") return false;
  const cost = Number(costRaw);
  const blockSize = Number(blockSizeRaw);
  const parallelization = Number(parallelizationRaw);
  if (!Number.isFinite(cost) || !Number.isFinite(blockSize) || !Number.isFinite(parallelization)) {
    return false;
  }

  const derived = await scrypt(
    password,
    salt,
    buildScryptOptions(cost, blockSize, parallelization)
  );

  const hashBuffer = Buffer.from(hash, "base64url");
  if (hashBuffer.length !== derived.length) return false;

  return timingSafeEqual(derived, hashBuffer);
};

const createSessionToken = () => randomBytes(32).toString("base64url");

export const createUser = async (
  email: string,
  password: string,
  options?: { role?: "admin" | "student"; trialDays?: number }
): Promise<AuthUser> => {
  const normalized = normalizeEmail(email);
  const { rows: existing } = await d1Query<AuthUserRow>(
    "SELECT id, email, password_hash FROM auth_users_v2 WHERE email = ? LIMIT 1",
    [normalized]
  );

  if (existing.length > 0) {
    throw new Error("该邮箱已注册");
  }

  const now = new Date();
  const userId = randomUUID();
  const passwordHash = await createPasswordHash(password);
  const role = options?.role ?? "student";
  const trialDays = options?.trialDays ?? 90; // 默认 3 个月
  const trialStartedAt = now.toISOString();
  const trialExpiresAt =
    role === "admin"
      ? "2099-12-31T23:59:59.000Z"
      : new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString();

  await d1Query(
    `INSERT INTO auth_users_v2
     (id, email, password_hash, role, trial_started_at, trial_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, normalized, passwordHash, role, trialStartedAt, trialExpiresAt, now.toISOString(), now.toISOString()]
  );

  return { id: userId, email: normalized };
};

export const validateUser = async (email: string, password: string): Promise<AuthUser | null> => {
  const normalized = normalizeEmail(email);
  const { rows } = await d1Query<AuthUserRow>(
    "SELECT id, email, password_hash FROM auth_users_v2 WHERE email = ? LIMIT 1",
    [normalized]
  );

  const user = rows[0];
  if (!user) return null;
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;

  return { id: user.id, email: user.email };
};

export const createSession = async (userId: string) => {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const sessionId = randomUUID();

  await d1Query(
    "INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [sessionId, userId, tokenHash, now.toISOString(), expiresAt.toISOString()]
  );

  return { token, expiresAt };
};

export const deleteSessionByToken = async (token: string) => {
  const tokenHash = hashSessionToken(token);
  await d1Query("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
};

export const getAuthUser = async (): Promise<AuthUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const { rows } = await d1Query<AuthSessionRow>(
    "SELECT s.user_id, s.expires_at, u.email, u.role FROM auth_sessions s JOIN auth_users_v2 u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1",
    [tokenHash]
  );

  const session = rows[0];
  if (!session) return null;

  const expiresAt = new Date(session.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await d1Query("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
    return null;
  }

  return { id: session.user_id, email: session.email, role: session.role };
};

export const setSessionCookie = (response: NextResponse, token: string) => {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge,
  });
  return response;
};

export const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 0,
  });
  return response;
};
