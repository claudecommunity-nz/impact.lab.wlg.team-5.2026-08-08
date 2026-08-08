/** @type {import('next').NextConfig} */
const nextConfig = {
  // The GeoJSON feed is meant to be read by the other teams' modules in the
  // shared common operating picture, so it has to be reachable cross-origin.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ]
  },
}

export default nextConfig
