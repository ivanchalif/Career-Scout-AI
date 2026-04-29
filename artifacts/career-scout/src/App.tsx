import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { Switch, Route, Redirect, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import LandingPage from "@/pages/landing";
import DashboardPage from "@/pages/dashboard";
import PostingDetailPage from "@/pages/posting-detail";
import ProfilePage from "@/pages/profile";
import InboxPage from "@/pages/inbox";
import OnboardingPage from "@/pages/onboarding";
import NotFound from "@/pages/not-found";
import { useGetProfile, getGetProfileQueryKey, setAuthTokenGetter } from "@workspace/api-client-react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const clerkProxyUrl = (import.meta.env.VITE_CLERK_PROXY_URL as string) || undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#6366f1",
    colorForeground: "#e2e8f0",
    colorMutedForeground: "#64748b",
    colorDanger: "#ef4444",
    colorBackground: "#0f172a",
    colorInput: "#1e2a3a",
    colorInputForeground: "#e2e8f0",
    colorNeutral: "#334155",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "bg-[#0f1929] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#1e2a3a] shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-semibold text-xl",
    headerSubtitle: "text-slate-400",
    socialButtonsBlockButtonText: "text-slate-200",
    formFieldLabel: "text-slate-300 text-sm",
    footerActionLink: "text-indigo-400 hover:text-indigo-300",
    footerActionText: "text-slate-400",
    dividerText: "text-slate-500",
    identityPreviewEditButton: "text-indigo-400",
    formFieldSuccessText: "text-emerald-400",
    alertText: "text-red-400",
    logoBox: "h-10",
    logoImage: "h-8 w-8",
    socialButtonsBlockButton: "border-[#1e2a3a] bg-[#1a2744] hover:bg-[#1e2f55] text-slate-200",
    formButtonPrimary: "bg-indigo-600 hover:bg-indigo-500 text-white",
    formFieldInput: "bg-[#1e2a3a] border-[#334155] text-slate-100",
    footerAction: "bg-transparent",
    dividerLine: "bg-[#1e2a3a]",
    alert: "bg-red-950/40 border-red-800",
    otpCodeFieldInput: "bg-[#1e2a3a] border-[#334155] text-slate-100",
    formFieldRow: "",
    main: "",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

/**
 * Wires Clerk's getToken into the shared API fetch client so every
 * React-Query hook automatically sends an Authorization: Bearer header.
 * Must be rendered inside <ClerkProvider>.
 */
function ApiAuthBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(getToken);
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  return null;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function SignedInHomeGate() {
  const profileQ = useGetProfile({ query: { queryKey: getGetProfileQueryKey() } });

  if (profileQ.isLoading) return null;

  const profile = profileQ.data;
  const hasProfile = !!(profile && (
    (profile.skills && profile.skills.length > 0) ||
    (profile.experienceHistory && profile.experienceHistory.length > 0)
  ));

  return <Redirect to={hasProfile ? "/dashboard" : "/profile"} />;
}

function HomeRoute() {
  return (
    <>
      <Show when="signed-in">
        <SignedInHomeGate />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={`${basePath}/profile`}
      signUpFallbackRedirectUrl={`${basePath}/profile`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back to Career Scout",
            subtitle: "Sign in to view your job matches",
          },
        },
        signUp: {
          start: {
            title: "Join Career Scout",
            subtitle: "Monitor and score job opportunities with AI",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ApiAuthBridge />
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRoute} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/dashboard">
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          </Route>
          <Route path="/postings/:id">
            {(params) => (
              <ProtectedRoute>
                <PostingDetailPage id={Number(params.id)} />
              </ProtectedRoute>
            )}
          </Route>
          <Route path="/profile">
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          </Route>
          <Route path="/inbox">
            <ProtectedRoute>
              <InboxPage />
            </ProtectedRoute>
          </Route>
          <Route path="/onboarding">
            <ProtectedRoute>
              <OnboardingPage />
            </ProtectedRoute>
          </Route>
          <Route component={NotFound} />
        </Switch>
        <Toaster />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
