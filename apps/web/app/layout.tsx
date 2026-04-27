import type { ReactNode } from "react";
import { Source_Code_Pro } from "next/font/google";
import AppNav from "./AppNav";
import "./globals.css";

const sourceCodePro = Source_Code_Pro({
  subsets: ["latin"],
  variable: "--font-dev",
  weight: ["400", "500", "600", "700"]
});

const navItems = [
  { href: "/status", label: "Status" },
  { href: "/ingest", label: "Ingest" },
  { href: "/conversations", label: "Conversations" },
  { href: "/config", label: "Config" },
  { href: "/incidents", label: "Incidents" }
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sourceCodePro.variable} console-bg min-h-screen`}>
        <div className="grid-noise min-h-screen">
          <div className="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[240px_1fr] lg:px-8">
            <AppNav navItems={navItems} />

            <main className="animate-rise [animation-delay:120ms]">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
