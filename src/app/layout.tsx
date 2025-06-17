import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Manrope } from 'next/font/google';
import { Inter } from 'next/font/google'
import { Pacifico } from 'next/font/google'
import { ReactNode } from 'react'
import { Analytics } from '@vercel/analytics/react';
import "./globals.css";


<Script src="https://wow.zamimg.com/js/tooltips.js" strategy="lazyOnload" />


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WoWCraft",
  description: "World of Warcraft profession planning and optimization tool",
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/icons/WoWCraft.png', sizes: 'any', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: '/icons/WoWCraft.png',
  },
};

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
});

// Initialize the Pacifico font - this is very distinctive and will be obvious when it loads
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  weight: ['100', '200', '300', '400', '500', '600', '700', '800', '900']
})

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={`${inter.className} overflow-hidden`}>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" href="/icons/WoWCraft.png" type="image/png" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icons/WoWCraft.png" />
      </head>
      <body className="overflow-hidden">
        {children}
        <Analytics />
      </body>
    </html>
  )
}
