import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/usage", destination: "/cursor/activity", permanent: true },
      { source: "/spend", destination: "/cursor/cost", permanent: true },
      { source: "/models", destination: "/cursor/activity", permanent: true },
      { source: "/tokens", destination: "/cursor/activity", permanent: true },
      { source: "/overview", destination: "/global/overview", permanent: true },
      { source: "/activity", destination: "/cursor/activity", permanent: true },
      { source: "/cost", destination: "/cursor/cost", permanent: true },
      { source: "/people", destination: "/cursor/people", permanent: true },
      { source: "/adoption", destination: "/cursor/adoption", permanent: true },
      { source: "/forecast", destination: "/global/forecast", permanent: true },
      { source: "/openai/:path*", destination: "/openai-api/:path*", permanent: true },
      { source: "/", destination: "/global/overview", permanent: false },
    ];
  },
};

export default nextConfig;
