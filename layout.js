export const metadata = { title: '🔥 ARC Roaster', description: 'Roast your Arc Testnet wallet' }
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
      </head>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
