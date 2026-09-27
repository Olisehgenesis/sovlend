import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      {
        source: "/donate/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://jumpstartafrica.org https://www.jumpstartafrica.org https://*.jumpstartafrica.org",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
