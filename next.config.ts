import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project (multiple lockfiles exist in the
  // monorepo parent, which would otherwise be auto-detected as the root).
  turbopack: {
    root: path.join(__dirname),
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
};

export default nextConfig;
