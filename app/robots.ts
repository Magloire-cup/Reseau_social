import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
        sitemap: "https://reseau-social-xshx.vercel.app/sitemap.xml",
        host: "https://reseau-social-xshx.vercel.app"
    };
}
