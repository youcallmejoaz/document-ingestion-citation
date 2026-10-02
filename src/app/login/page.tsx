import { Logo } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const demo = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="text-lg" />
          <p className="text-sm text-ink-2">Answers from your company&apos;s SOPs and policies, with sources.</p>
        </div>
        <LoginForm next={next?.startsWith("/") ? next : "/chat"} demo={demo} />
      </div>
    </main>
  );
}
