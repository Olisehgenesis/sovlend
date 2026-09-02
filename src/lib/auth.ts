import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";

import { prisma } from "./prisma";

const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const authUrl = new URL(baseUrl);
const rpId = authUrl.hostname;
const localDevelopment = rpId === "localhost" || rpId === "127.0.0.1";
const trustedOrigins = localDevelopment
  ? ["http://localhost", "http://localhost:3000", "http://127.0.0.1", "http://127.0.0.1:3000"]
  : [authUrl.origin];

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
    }),
    nextCookies(),
  ],
  advanced: {
    database: { joins: true },
    cookiePrefix: "sovlend",
  },
});