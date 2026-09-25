export function GeminiAvatar({ size = 43 }: { size?: number }) {
    return <img className="avatar" style={{ width: size, height: size }} src="/images/gemini-avatar.svg" alt="Gemini AI" />;
}
