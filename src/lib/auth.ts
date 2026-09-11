import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { z } from "zod";

import { prisma } from "./prisma";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const authUrl = new URL(baseUrl);
const rpId = authUrl.hostname;
const localDevelopment = rpId === "localhost" || rpId === "127.0.0.1";
const trustedOrigins = localDevelopment
  ? ["http://localhost", "http://localhost:3000", "http://127.0.0.1", "http://127.0.0.1:3000"]
  : [authUrl.origin];

/**
 * Passkey-first investor sign-up. The client passes this (as JSON) via the passkey
 * plugin's opaque `context` string when no session exists yet, so a brand new investor
 * can register a passkey and an account in one step -- no password, no admin invite.
 * The `intent` marker keeps this path investor-only: staff accounts are still admin-created.
 */
const investorPasskeySignupContextSchema = z.object({
  intent: z.literal("investor-signup"),
  name: z.string().trim().min(2).max(120),
  email: z.email(),
});

function parseInvestorPasskeySignupContext(context: string | null | undefined) {
  if (!context) return null;
  try {
    return investorPasskeySignupContextSchema.parse(JSON.parse(context));
  } catch {
    return null;
  }
}

export const auth = betterAuth({
  appName: "SovLend",
  baseURL: baseUrl,
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 6,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 30,
  },
  user: {
    additionalFields: {
      organizationId: { type: "string", required: false, input: true },
      officeId: { type: "string", required: false, input: true },
      systemRole: { type: "string", required: false, defaultValue: "CLIENT", input: true },
      mustChangePassword: { type: "boolean", required: false, defaultValue: false, input: false },
    },
  },
  plugins: [
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
      impersonationSessionDuration: 60 * 30,
    }),
    passkey({
      rpID: rpId,
      rpName: "SovLend",
      origin: baseUrl,
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      registration: {
        // Allow passkey registration without an existing session -- but only to create a
        // brand new investor account (resolveUser below rejects anything else).
        requireSession: false,
        resolveUser: async ({ ctx, context }) => {
          const signup = parseInvestorPasskeySignupContext(context);
          if (!signup) {
            throw new APIError("BAD_REQUEST", {
              message: "Sign in with an existing passkey, or provide your name and email to create an investor account.",
            });
          }
          const existing = await prisma.user.findUnique({ where: { email: signup.email } });
          if (existing) {
            throw new APIError("CONFLICT", { message: "An account with this email already exists. Sign in instead." });
          }
          const user = await ctx.context.internalAdapter.createUser(
            { email: signup.email, name: signup.name, role: "user", systemRole: "INVESTOR" },
            { method: "passkey" },
          );
          return { id: user.id, name: user.email, displayName: user.name };
        },
        afterVerification: async ({ user, context }) => {
          // Only investor passkey-first sign-ups reach here with a matching context; staff
          // adding a passkey to their own account via settings passes no context at all.
          if (!parseInvestorPasskeySignupContext(context)) return;
          await prisma.investorProfile.upsert({
            where: { userId: user.id },
            update: {},
            create: { userId: user.id, displayName: user.displayName ?? user.name },
          });
        },
      },
    }),
    nextCookies(),
  ],
  advanced: {
    database: { joins: true },
    cookiePrefix: "sovlend",
  },
});