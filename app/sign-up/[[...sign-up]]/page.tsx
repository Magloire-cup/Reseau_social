import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="auth">
      <section className="auth-card">
        <div className="auth-clerk">
          <SignUp />
        </div>
      </section>
    </main>
  );
}
