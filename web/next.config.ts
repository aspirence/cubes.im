import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The monorepo root, NOT this package: npm workspaces hoist dependencies to
  // the root `node_modules`, and Turbopack refuses to resolve anything outside
  // its root — pinning it here made `next` itself unresolvable from src/app.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  // Transpile Ant Design and its ESM dependencies so they render correctly in
  // React Server Components / during prerendering under Turbopack.
  transpilePackages: [
    "antd",
    "@ant-design/icons",
    "@ant-design/icons-svg",
    "@ant-design/nextjs-registry",
    "@ant-design/cssinjs",
    "rc-util",
    "rc-pagination",
    "rc-picker",
    "rc-notification",
    "rc-tooltip",
    "rc-tree",
    "rc-table",
    "rc-input",
    "rc-field-form",
  ],
  // Social Studio became Content Studio, and the folder name under app/(app)/apps
  // is the public URL — so /apps/social-studio stopped resolving the moment it was
  // renamed. Anyone holding a bookmark or an old deep link would hit a 404, so the
  // old path is kept alive here. 308 rather than 307: the move is permanent and
  // the method should be preserved.
  async redirects() {
    return [
      {
        source: "/apps/social-studio",
        destination: "/apps/content-studio",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
