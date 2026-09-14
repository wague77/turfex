/** @type {import('next').NextConfig} */
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:8000";

const nextConfig = {
  // Permet de servir les images depuis Unsplash et autres domaines externes
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  // Proxy : toutes les requêtes /api/* sont redirigées vers le backend Railway
  // → élimine les problèmes CORS et les erreurs Network Error sur Vercel
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
  experimental: {},
};

module.exports = nextConfig;
