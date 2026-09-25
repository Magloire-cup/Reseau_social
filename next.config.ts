import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    typedRoutes: true,
    outputFileTracingRoot: process.cwd()
};

export default nextConfig;