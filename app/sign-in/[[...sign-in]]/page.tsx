import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="auth">
      <section className="auth-card">
        <div className="auth-clerk">
          <SignIn />
        </div>
      </section>
    </main>
  );
}
