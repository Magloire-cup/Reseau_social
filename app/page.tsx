import type { Metadata } from "next";
import PulseApp from "../components/PulseApp";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function HomePage() {
    return <PulseApp />;
}
