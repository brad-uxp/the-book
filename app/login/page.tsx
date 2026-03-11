import { signIn } from "@/auth";
import Image from "next/image";
import { Button } from "@/components/ui/button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-linear-to-br from-orange-50 via-background to-stone-100 px-4 py-12">
      <div className="w-full max-w-95 space-y-7">

        {/* Brand mark */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center justify-center rounded-2xl bg-white border shadow-sm p-3.5">
            <Image src="/logo.svg" alt="TheBook logo" width={44} height={44} className="h-11 w-auto" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">TheBook</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Personal accounting &amp; invoice management
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {/* Orange accent bar */}
          <div className="h-1 bg-linear-to-r from-orange-400 to-orange-500" />

          <div className="px-8 py-8 space-y-6">
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Welcome back</p>
              <p className="text-xs text-muted-foreground">
                Sign in to access your workspace
              </p>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
                Your email is not authorized to access this app.
              </div>
            )}

            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <Button
                type="submit"
                variant="outline"
                size="lg"
                className="w-full h-11 gap-3 font-medium"
              >
                <svg
                  className="h-4 w-4 shrink-0"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Sign in with Google
              </Button>
            </form>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          © {year} TheBook · Private access only
        </p>
      </div>
    </div>
  );
}
