import type { NextConfig } from "next";

const downloadableFixtures = [
  "example-wallet-metadata.json",
  "example-unsigned-request.json",
  "invalid-signed-malformed.json",
  "invalid-signed-mismatch.json",
  "invalid-signed-wrong-chain.json",
];

const nextConfig: NextConfig = {
  // The website checks its entrypoints and imports; isolated signer/research suites use tsconfig.json.
  typescript: { tsconfigPath: 'tsconfig.web.json', ignoreBuildErrors: false },
  // Boot images are delivered separately; tracing them into web routes exhausts Windows file resources.
  outputFileTracingExcludes: { '/*': ['./outputs/**/*', './work/**/*'] },
  allowedDevOrigins: ["127.0.0.1"],
  async redirects() { return [
    ...['husher','manual','send','receive','swap','request','assets','agents','activity','companion','live-demo','showcase'].map(route=>({source:'/'+route,destination:'/app/'+route,permanent:false})),
    // Static archives bypass API release gates. Keep historical files locally,
    // but direct requests must reach release status until a reviewed release exists.
    ...['drivekey-companion-v2.zip','drivekey-offline-signer.zip','drivekey-offline-v2.zip','drivekey-offline-v3.zip'].map(file=>({source:'/downloads/'+file,destination:'/app/setup',permanent:false})),
  ]; },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), hid=(self), publickey-credentials-create=(self), publickey-credentials-get=(self)" },
          { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:47831; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'` },
        ],
      },
      ...downloadableFixtures.map((file) => ({
        source: `/fixtures/${file}`,
        headers: [{ key: "Content-Disposition", value: `attachment; filename="${file}"` }],
      })),
      {
        source: "/downloads/drivekey-offline-signer.zip",
        headers: [
          { key: "Content-Disposition", value: "attachment; filename=\"drivekey-offline-signer.zip\"" },
          { key: "Content-Type", value: "application/zip" },
        ],
      },
    ];
  }
};

export default nextConfig;
