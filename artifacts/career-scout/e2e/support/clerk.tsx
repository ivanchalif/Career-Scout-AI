import type { ReactNode } from "react";

// Populated per browser context before App loads. These are synthetic identities,
// not Clerk credentials; the fixture intercepts every API request.
declare global {
  interface Window {
    __dismissalTestAccount: { id: string; email: string };
  }
}

const getToken = async () => window.__dismissalTestAccount.id;
const addListener = () => () => {};
const signOut = async () => {};

export function ClerkProvider({ children }: { children: ReactNode }) {
  return children;
}
export function Show({ when, children }: { when: string; children: ReactNode }) {
  return when === "signed-in" ? children : null;
}
export function useAuth() {
  return { userId: window.__dismissalTestAccount.id, getToken, isLoaded: true, isSignedIn: true };
}
export function useUser() {
  return {
    user: {
      id: window.__dismissalTestAccount.id,
      firstName: "Dismissal",
      lastName: "Test",
      emailAddresses: [{ emailAddress: window.__dismissalTestAccount.email }],
    },
  };
}
export function useClerk() {
  return { addListener, signOut };
}
export function SignIn() { return null; }
export function SignUp() { return null; }
