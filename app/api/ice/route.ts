import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const STUN_SERVERS: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: "stun:stun.cloudflare.com:3478" }
];

// Sans relais TURN, deux appareils derrière un NAT strict (CGNAT des réseaux mobiles)
// ne peuvent pas établir la connexion média. Les identifiants viennent de l'environnement
// pour ne pas finir dans le bundle client.
export async function GET() {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
    const urls = (process.env.TURN_URLS ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
    const username = process.env.TURN_USERNAME;
    const credential = process.env.TURN_CREDENTIAL;
    const iceServers: RTCIceServer[] = [...STUN_SERVERS];
    const turn = urls.length > 0 && Boolean(username) && Boolean(credential);
    if (turn) iceServers.push({ urls, username, credential });
    return NextResponse.json({ iceServers, turn });
}
