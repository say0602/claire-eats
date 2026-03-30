import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const nextConfig: NextConfig = {
  turbopack: {
    root: dirname,
  },
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
